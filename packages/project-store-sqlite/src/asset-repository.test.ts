import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it, afterEach } from "vitest";
import { emptyDocument } from "@blocksync/project-envelope";
import {
  GLOBAL_DISK_BYTES,
  ORG_QUOTA_BYTES,
  RESERVATION_TTL_MS,
  createSqliteAssetRepository,
  GlobalDiskExceededError,
  migrate,
  migrateAssets,
  migrateAuth,
  OrgQuotaExceededError,
  type AssetRepository,
} from "./index.js";

const M = 1024 * 1024;

function sha(n: number): string {
  return n.toString(16).padStart(64, "0").slice(-64);
}

function tempDb(): { db: Database.Database; dbPath: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "asset-repo-"));
  const dbPath = join(dir, "test.sqlite");
  const db = new Database(dbPath);
  migrate(db);
  migrateAuth(db);
  migrateAssets(db);
  return { db, dbPath, dir };
}

function seedOrg(db: Database.Database, orgId = "org-1", now?: string): string {
  const createdAt = now ?? new Date().toISOString();
  db.prepare(
    `INSERT INTO organizations (id, name, status, created_at) VALUES (?, ?, 'active', ?)`,
  ).run(orgId, "Test Org", createdAt);
  return createdAt;
}

function openRepo(db: Database.Database): AssetRepository {
  return createSqliteAssetRepository(db);
}

const globalReservationChildPath = fileURLToPath(
  new URL("./global-reservation-child.ts", import.meta.url),
);
const quotaReservationChildPath = fileURLToPath(
  new URL("./quota-reservation-child.ts", import.meta.url),
);

function runGlobalReservationChild(
  dbPath: string,
  reservationId: string,
  importSessionId: string,
  reservedBytes: number,
  fileBytes: number,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        globalReservationChildPath,
        dbPath,
        reservationId,
        importSessionId,
        String(reservedBytes),
        String(fileBytes),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`global reservation child exited ${code}`));
        return;
      }
      resolve(JSON.parse(stdout) as { ok: boolean; error?: string });
    });
  });
}

function runQuotaReservationChild(
  dbPath: string,
  reservationId: string,
  organizationId: string,
  importSessionId: string,
  sha256: string,
  byteLength: number,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        quotaReservationChildPath,
        dbPath,
        reservationId,
        organizationId,
        importSessionId,
        sha256,
        String(byteLength),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`quota reservation child exited ${code}`));
        return;
      }
      resolve(JSON.parse(stdout) as { ok: boolean; error?: string });
    });
  });
}

describe("asset repository", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    dirs.length = 0;
  });

  it("rejects uppercase sha256 CHECK on asset_objects", () => {
    const { db, dir } = tempDb();
    dirs.push(dir);
    seedOrg(db);
    expect(() =>
      db.prepare(
        `INSERT INTO asset_objects (sha256, byte_length, md5_hex, data_format, created_at)
         VALUES (?, 1, ?, 'png', ?)`,
      ).run("A".repeat(64), "a".repeat(32), new Date().toISOString()),
    ).toThrow();
    db.close();
  });

  it("createGlobalDiskReservation succeeds under cap", () => {
    const { db, dir } = tempDb();
    dirs.push(dir);
    seedOrg(db);
    const repo = openRepo(db);
    repo.createGlobalDiskReservation({
      reservationId: "res-1",
      importSessionId: "session-1",
      reservedBytes: 128 * M,
      fileBytes: 0,
    });
    expect(
      db
        .prepare(`SELECT COUNT(*) AS c FROM global_disk_reservations`)
        .get() as { c: number },
    ).toEqual({ c: 1 });
    db.close();
  });

  it("parallel global reservations prevent over 2 GiB cap", async () => {
    const { db, dbPath, dir } = tempDb();
    dirs.push(dir);
    seedOrg(db);
    const repo = openRepo(db);
    const firstBytes = GLOBAL_DISK_BYTES - 50 * M;
    repo.createGlobalDiskReservation({
      reservationId: "res-a",
      importSessionId: "session-a",
      reservedBytes: firstBytes,
      fileBytes: 0,
    });
    db.close();

    const [r1, r2] = await Promise.all([
      runGlobalReservationChild(dbPath, "res-b", "session-b", 80 * M, 0),
      runGlobalReservationChild(dbPath, "res-c", "session-c", 80 * M, 0),
    ]);
    const successes = [r1, r2].filter((r) => r.ok);
    expect(successes).toHaveLength(0);
  });

  it("materialized_bytes does not double-count toward globalUsed", () => {
    const { db, dir } = tempDb();
    dirs.push(dir);
    const now = seedOrg(db);
    const repo = openRepo(db);
    repo.createGlobalDiskReservation({
      reservationId: "res-mat",
      importSessionId: "session-mat",
      reservedBytes: 1000,
      fileBytes: 500,
      now,
    });
    expect(repo.computeGlobalUsedBytes(500, now)).toBe(1500);

    repo.materializeGlobalDiskReservation({
      importSessionId: "session-mat",
      deltaBytes: 300,
    });
    expect(repo.computeGlobalUsedBytes(800, now)).toBe(1500);
    db.close();
  });

  it("releaseGlobalDiskReservation removes reservation row", () => {
    const { db, dir } = tempDb();
    dirs.push(dir);
    seedOrg(db);
    const repo = openRepo(db);
    repo.createGlobalDiskReservation({
      reservationId: "res-rel",
      importSessionId: "session-rel",
      reservedBytes: 100,
      fileBytes: 0,
    });
    repo.releaseGlobalDiskReservation("session-rel");
    expect(
      db
        .prepare(`SELECT COUNT(*) AS c FROM global_disk_reservations`)
        .get() as { c: number },
    ).toEqual({ c: 0 });
    db.close();
  });

  it("org quota distinct sha union counts duplicate revision refs once", () => {
    const { db, dir } = tempDb();
    dirs.push(dir);
    const now = seedOrg(db);
    const repo = openRepo(db);
    const assetSha = sha(1);
    db.prepare(
      `INSERT INTO asset_objects (sha256, byte_length, md5_hex, data_format, created_at)
       VALUES (?, ?, ?, 'png', ?)`,
    ).run(assetSha, 100, "b".repeat(32), now);

    const doc = emptyDocument();
    const envelope = {
      format: "blocksync.project/v1" as const,
      projectId: "proj-1",
      organizationId: "org-1",
      title: "T",
      revision: 0,
      schemaVersion: 1,
      contentHash: "c".repeat(64),
      updatedAt: now,
      updatedByUserId: "user-1",
      document: doc,
    };
    db.prepare(
      `INSERT INTO projects (id, organization_id, owner_user_id, title, head_revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    ).run("proj-1", "org-1", "user-1", "T", now, now);
    for (const rev of [0, 1]) {
      db.prepare(
        `INSERT INTO project_revisions (
          project_id, revision, envelope_json, content_hash, request_hash, actor_user_id, created_at
        ) VALUES (?, ?, ?, ?, '', 'user-1', ?)`,
      ).run("proj-1", rev, JSON.stringify(envelope), "c".repeat(64), now);
    }

    expect(repo.computeOrgQuotaBytes("org-1", now)).toBe(0);

    db.prepare(
      `UPDATE project_revisions SET envelope_json = ? WHERE project_id = ? AND revision = 1`,
    ).run(
      JSON.stringify({
        ...envelope,
        revision: 1,
        document: {
          ...doc,
          targets: [
            {
              ...doc.targets[0]!,
              costumes: [
                {
                  assetId: "b".repeat(32),
                  contentSha256: assetSha,
                  dataFormat: "png",
                  md5ext: `${"b".repeat(32)}.png`,
                  name: "c1",
                },
              ],
            },
          ],
        },
      }),
      "proj-1",
    );

    expect(repo.computeOrgQuotaBytes("org-1", now)).toBe(100);
    db.close();
  });

  it("parallel org quota reservations prevent over 512 MiB cap", async () => {
    const { db, dbPath, dir } = tempDb();
    dirs.push(dir);
    seedOrg(db);
    const repo = openRepo(db);
    repo.createQuotaReservation({
      reservationId: "q-res-a",
      organizationId: "org-1",
      importSessionId: "import-a",
      shas: [{ sha256: sha(10), byteLength: 400 * M }],
    });
    db.close();

    const [r1, r2] = await Promise.all([
      runQuotaReservationChild(
        dbPath,
        "q-res-b",
        "org-1",
        "import-b",
        sha(11),
        200 * M,
      ),
      runQuotaReservationChild(
        dbPath,
        "q-res-c",
        "org-1",
        "import-c",
        sha(12),
        200 * M,
      ),
    ]);
    expect([r1, r2].filter((r) => r.ok)).toHaveLength(0);
  });

  it("expired reservations are excluded from quota and deleted on reconcile", () => {
    const { db, dir } = tempDb();
    dirs.push(dir);
    const now = seedOrg(db);
    const repo = openRepo(db);
    const expiredAt = new Date(Date.parse(now) - 1000).toISOString();
    db.prepare(
      `INSERT INTO organization_asset_quota_reservations (
        reservation_id, organization_id, import_session_id, reserved_bytes, expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("exp-res", "org-1", "exp-session", 500 * M, expiredAt, now);
    db.prepare(
      `INSERT INTO organization_asset_quota_reservation_shas (
        reservation_id, sha256, byte_length
      ) VALUES (?, ?, ?)`,
    ).run("exp-res", sha(99), 500 * M);

    expect(repo.computeOrgQuotaBytes("org-1", now)).toBe(0);
    const deleted = repo.deleteExpiredReservations(now);
    expect(deleted.orgQuota).toBe(1);
    db.close();
  });

  it("importSb3CreateProjectAtomic releases reservations and creates project", () => {
    const { db, dir } = tempDb();
    dirs.push(dir);
    const now = seedOrg(db);
    const repo = openRepo(db);
    const assetSha = sha(2);
    repo.createGlobalDiskReservation({
      reservationId: "g-res",
      importSessionId: "import-final",
      reservedBytes: 128 * M,
      fileBytes: 1024,
      now,
    });
    repo.createQuotaReservation({
      reservationId: "o-res",
      organizationId: "org-1",
      importSessionId: "import-final",
      shas: [{ sha256: assetSha, byteLength: 1024 }],
      now,
    });
    repo.createImportLeases({
      organizationId: "org-1",
      importSessionId: "import-final",
      leases: [{ leaseId: "lease-1", sha256: assetSha }],
      now,
    });

    const envelope = {
      format: "blocksync.project/v1" as const,
      projectId: "proj-import",
      organizationId: "org-1",
      title: "Imported",
      revision: 0,
      schemaVersion: 1,
      contentHash: "d".repeat(64),
      updatedAt: now,
      updatedByUserId: "user-1",
      document: emptyDocument(),
    };

    repo.importSb3CreateProjectAtomic({
      organizationId: "org-1",
      ownerUserId: "user-1",
      projectId: "proj-import",
      title: "Imported",
      envelope,
      assetObjects: [
        {
          sha256: assetSha,
          byteLength: 1024,
          md5Hex: "e".repeat(32),
          dataFormat: "png",
        },
      ],
      grantShas: [assetSha],
      releaseImportSessionId: "import-final",
      fileBytes: 1024,
      now,
    });

    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM global_disk_reservations`).get() as {
        c: number;
      },
    ).toEqual({ c: 0 });
    expect(
      db
        .prepare(`SELECT COUNT(*) AS c FROM organization_asset_quota_reservations`)
        .get() as { c: number },
    ).toEqual({ c: 0 });
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM asset_import_leases`).get() as {
        c: number;
      },
    ).toEqual({ c: 0 });
    expect(
      db.prepare(`SELECT id FROM projects WHERE id = ?`).get("proj-import"),
    ).toBeTruthy();
    db.close();
  });

  it("importSb3CreateProjectAtomic rejects org quota exceeded", () => {
    const { db, dir } = tempDb();
    dirs.push(dir);
    const now = seedOrg(db);
    const repo = openRepo(db);
    const assetSha = sha(3);
    repo.createGlobalDiskReservation({
      reservationId: "g-res2",
      importSessionId: "import-over",
      reservedBytes: 128 * M,
      fileBytes: 0,
      now,
    });
    repo.createQuotaReservation({
      reservationId: "o-res2",
      organizationId: "org-1",
      importSessionId: "import-over",
      shas: [{ sha256: sha(4), byteLength: ORG_QUOTA_BYTES }],
      now,
    });

    const envelope = {
      format: "blocksync.project/v1" as const,
      projectId: "proj-over",
      organizationId: "org-1",
      title: "Over",
      revision: 0,
      schemaVersion: 1,
      contentHash: "f".repeat(64),
      updatedAt: now,
      updatedByUserId: "user-1",
      document: emptyDocument(),
    };

    expect(() =>
      repo.importSb3CreateProjectAtomic({
        organizationId: "org-1",
        ownerUserId: "user-1",
        projectId: "proj-over",
        title: "Over",
        envelope,
        assetObjects: [
          {
            sha256: assetSha,
            byteLength: 1024,
            md5Hex: "a".repeat(32),
            dataFormat: "png",
          },
        ],
        grantShas: [assetSha],
        releaseImportSessionId: "import-over",
        fileBytes: 1024,
        now,
      }),
    ).toThrow(OrgQuotaExceededError);

    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM projects`).get() as { c: number },
    ).toEqual({ c: 0 });
    db.close();
  });

  it("createGlobalDiskReservation rejects when over cap synchronously", () => {
    const { db, dir } = tempDb();
    dirs.push(dir);
    seedOrg(db);
    const repo = openRepo(db);
    repo.createGlobalDiskReservation({
      reservationId: "res-full",
      importSessionId: "session-full",
      reservedBytes: GLOBAL_DISK_BYTES,
      fileBytes: 0,
    });
    expect(() =>
      repo.createGlobalDiskReservation({
        reservationId: "res-over",
        importSessionId: "session-over",
        reservedBytes: 1,
        fileBytes: 0,
      }),
    ).toThrow(GlobalDiskExceededError);
    db.close();
  });

  it("createQuotaReservation rejects when over org cap", () => {
    const { db, dir } = tempDb();
    dirs.push(dir);
    seedOrg(db);
    const repo = openRepo(db);
    expect(() =>
      repo.createQuotaReservation({
        reservationId: "q-over",
        organizationId: "org-1",
        importSessionId: "import-q-over",
        shas: [{ sha256: sha(5), byteLength: ORG_QUOTA_BYTES + 1 }],
      }),
    ).toThrow(OrgQuotaExceededError);
    db.close();
  });

  it("TTL is approximately 15 minutes", () => {
    const { db, dir } = tempDb();
    dirs.push(dir);
    const now = seedOrg(db);
    const repo = openRepo(db);
    repo.createGlobalDiskReservation({
      reservationId: "res-ttl",
      importSessionId: "session-ttl",
      reservedBytes: 100,
      fileBytes: 0,
      now,
    });
    const row = db
      .prepare(`SELECT expires_at AS expiresAt FROM global_disk_reservations`)
      .get() as { expiresAt: string };
    expect(Date.parse(row.expiresAt) - Date.parse(now)).toBe(RESERVATION_TTL_MS);
    db.close();
  });
});
