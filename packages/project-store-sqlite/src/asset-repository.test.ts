import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it, afterEach } from "vitest";
import {
  emptyDocument,
  type ProjectEnvelopeV1,
} from "@blocksync/project-envelope";
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

function md5(n: number): string {
  return n.toString(16).padStart(32, "a").slice(-32);
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

function importEnvelope(
  now: string,
  projectId: string,
  assetShas: string[],
): ProjectEnvelopeV1 {
  const document = emptyDocument();
  return {
    format: "blocksync.project/v1",
    projectId,
    organizationId: "org-1",
    title: "Imported",
    revision: 0,
    schemaVersion: 2,
    contentHash: "d".repeat(64),
    updatedAt: now,
    updatedByUserId: "user-1",
    document: {
      ...document,
      schemaVersion: 2,
      targets: [
        {
          ...document.targets[0]!,
          currentCostume: 0,
          costumes: assetShas.map((contentSha256, index) => ({
            kind: "costume" as const,
            name: `costume-${index}`,
            assetId: md5(index),
            md5ext: `${md5(index)}.png`,
            dataFormat: "png",
            contentSha256,
            rotationCenterX: 0,
            rotationCenterY: 0,
          })),
        },
      ],
    },
  };
}

function createActiveImportResources(
  repo: AssetRepository,
  args: {
    importSessionId: string;
    assetObjects: Array<{ sha256: string; byteLength: number }>;
    now: string;
  },
): void {
  repo.createGlobalDiskReservation({
    reservationId: `global-${args.importSessionId}`,
    importSessionId: args.importSessionId,
    reservedBytes: 128 * M,
    fileBytes: 0,
    now: args.now,
  });
  repo.createQuotaReservation({
    reservationId: `quota-${args.importSessionId}`,
    organizationId: "org-1",
    importSessionId: args.importSessionId,
    shas: args.assetObjects,
    now: args.now,
  });
  repo.createImportLeases({
    organizationId: "org-1",
    importSessionId: args.importSessionId,
    leases: args.assetObjects.map((asset, index) => ({
      leaseId: `lease-${args.importSessionId}-${index}`,
      sha256: asset.sha256,
    })),
    now: args.now,
  });
}

const globalReservationChildPath = fileURLToPath(
  new URL("./global-reservation-child.ts", import.meta.url),
);
const extendGlobalReservationChildPath = fileURLToPath(
  new URL("./extend-global-reservation-child.ts", import.meta.url),
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

function runExtendGlobalReservationChild(
  dbPath: string,
  importSessionId: string,
  additionalBytes: number,
  fileBytes: number,
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        extendGlobalReservationChildPath,
        dbPath,
        importSessionId,
        String(additionalBytes),
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
        reject(new Error(`global reservation extension child exited ${code}`));
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
    const firstBytes = GLOBAL_DISK_BYTES - 100 * M;
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
    expect(successes).toHaveLength(1);
    expect([r1, r2].filter((r) => !r.ok)).toEqual([
      expect.objectContaining({ error: "GlobalDiskExceededError" }),
    ]);
  });

  it("parallel global reservation extensions allow exactly one under cap", async () => {
    const { db, dbPath, dir } = tempDb();
    dirs.push(dir);
    seedOrg(db);
    const repo = openRepo(db);
    repo.createGlobalDiskReservation({
      reservationId: "res-base",
      importSessionId: "session-base",
      reservedBytes: GLOBAL_DISK_BYTES - 100 * M,
      fileBytes: 0,
    });
    repo.createGlobalDiskReservation({
      reservationId: "res-extend-b",
      importSessionId: "session-extend-b",
      reservedBytes: 0,
      fileBytes: 0,
    });
    repo.createGlobalDiskReservation({
      reservationId: "res-extend-c",
      importSessionId: "session-extend-c",
      reservedBytes: 0,
      fileBytes: 0,
    });
    db.close();

    const [r1, r2] = await Promise.all([
      runExtendGlobalReservationChild(
        dbPath,
        "session-extend-b",
        80 * M,
        0,
      ),
      runExtendGlobalReservationChild(
        dbPath,
        "session-extend-c",
        80 * M,
        0,
      ),
    ]);
    expect([r1, r2].filter((r) => r.ok)).toHaveLength(1);
    expect([r1, r2].filter((r) => !r.ok)).toEqual([
      expect.objectContaining({ error: "GlobalDiskExceededError" }),
    ]);
  });

  it("extendGlobalDiskReservation adds bytes to the target reservation", () => {
    const { db, dir } = tempDb();
    dirs.push(dir);
    const now = seedOrg(db);
    const repo = openRepo(db);
    repo.createGlobalDiskReservation({
      reservationId: "res-extend-success",
      importSessionId: "session-extend-success",
      reservedBytes: 100,
      fileBytes: 0,
      now,
    });

    repo.extendGlobalDiskReservation({
      importSessionId: "session-extend-success",
      additionalBytes: 25,
      fileBytes: 0,
      now,
    });

    expect(
      db
        .prepare(
          `SELECT reserved_bytes AS reservedBytes
           FROM global_disk_reservations
           WHERE import_session_id = ?`,
        )
        .get("session-extend-success"),
    ).toEqual({ reservedBytes: 125 });
    db.close();
  });

  it("extendGlobalDiskReservation requires an active reservation", () => {
    const { db, dir } = tempDb();
    dirs.push(dir);
    const now = seedOrg(db);
    const repo = openRepo(db);
    repo.createGlobalDiskReservation({
      reservationId: "res-extend-expired",
      importSessionId: "session-extend-expired",
      reservedBytes: 100,
      fileBytes: 0,
      now,
    });
    const afterExpiry = new Date(
      Date.parse(now) + RESERVATION_TTL_MS + 1,
    ).toISOString();

    expect(() =>
      repo.extendGlobalDiskReservation({
        importSessionId: "session-extend-expired",
        additionalBytes: 1,
        fileBytes: 0,
        now: afterExpiry,
      }),
    ).toThrow(/RESERVATION_NOT_FOUND/);
    expect(
      db
        .prepare(
          `SELECT reserved_bytes AS reservedBytes
           FROM global_disk_reservations
           WHERE import_session_id = ?`,
        )
        .get("session-extend-expired"),
    ).toEqual({ reservedBytes: 100 });
    db.close();
  });

  it("global reservation APIs reject non-finite and negative capacity inputs", () => {
    const { db, dir } = tempDb();
    dirs.push(dir);
    const now = seedOrg(db);
    const repo = openRepo(db);
    const errors: unknown[] = [];

    const invalidInputs = [
      { reservedBytes: 100, fileBytes: Number.NaN },
      { reservedBytes: Number.NaN, fileBytes: 0 },
      { reservedBytes: -1, fileBytes: 0 },
    ];
    for (const [index, args] of invalidInputs.entries()) {
      try {
        repo.createGlobalDiskReservation({
          reservationId: `invalid-${index}`,
          importSessionId: `invalid-${index}`,
          ...args,
          now,
        });
      } catch (err) {
        errors.push(err);
      }
    }

    repo.createGlobalDiskReservation({
      reservationId: "res-invalid-extend",
      importSessionId: "session-invalid-extend",
      reservedBytes: 100,
      fileBytes: 0,
      now,
    });
    let extendError: unknown;
    try {
      repo.extendGlobalDiskReservation({
        importSessionId: "session-invalid-extend",
        additionalBytes: 1,
        fileBytes: Number.NaN,
        now,
      });
    } catch (err) {
      extendError = err;
    }

    db.close();
    expect(errors).toHaveLength(3);
    expect(errors).toEqual([
      expect.objectContaining({ name: "RangeError" }),
      expect.objectContaining({ name: "RangeError" }),
      expect.objectContaining({ name: "RangeError" }),
    ]);
    expect(extendError).toEqual(
      expect.objectContaining({ name: "RangeError" }),
    );
  });

  it("materialize rejects bytes beyond the active reservation", () => {
    const { db, dir } = tempDb();
    dirs.push(dir);
    const now = seedOrg(db);
    const repo = openRepo(db);
    repo.createGlobalDiskReservation({
      reservationId: "res-materialize-cap",
      importSessionId: "session-materialize-cap",
      reservedBytes: 100,
      fileBytes: 0,
      now,
    });

    expect(() =>
      repo.materializeGlobalDiskReservation({
        importSessionId: "session-materialize-cap",
        deltaBytes: 101,
      }),
    ).toThrow();
    expect(
      db
        .prepare(
          `SELECT materialized_bytes AS materializedBytes
           FROM global_disk_reservations
           WHERE import_session_id = ?`,
        )
        .get("session-materialize-cap"),
    ).toEqual({ materializedBytes: 0 });
    db.close();
  });

  it("materialize rejects an expired reservation", () => {
    const { db, dir } = tempDb();
    dirs.push(dir);
    const now = seedOrg(db);
    const repo = openRepo(db);
    repo.createGlobalDiskReservation({
      reservationId: "res-materialize-expired",
      importSessionId: "session-materialize-expired",
      reservedBytes: 100,
      fileBytes: 0,
      now,
    });
    const afterExpiry = new Date(
      Date.parse(now) + RESERVATION_TTL_MS + 1,
    ).toISOString();

    expect(() =>
      repo.materializeGlobalDiskReservation({
        importSessionId: "session-materialize-expired",
        deltaBytes: 1,
        now: afterExpiry,
      }),
    ).toThrow();
    expect(
      db
        .prepare(
          `SELECT materialized_bytes AS materializedBytes
           FROM global_disk_reservations
           WHERE import_session_id = ?`,
        )
        .get("session-materialize-expired"),
    ).toEqual({ materializedBytes: 0 });
    db.close();
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
        80 * M,
      ),
      runQuotaReservationChild(
        dbPath,
        "q-res-c",
        "org-1",
        "import-c",
        sha(12),
        80 * M,
      ),
    ]);
    expect([r1, r2].filter((r) => r.ok)).toHaveLength(1);
    expect([r1, r2].filter((r) => !r.ok)).toEqual([
      expect.objectContaining({ error: "OrgQuotaExceededError" }),
    ]);
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

    const envelope = importEnvelope(now, "proj-import", [assetSha]);

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

  it("importSb3CreateProjectAtomic rejects a session with no reservations or leases", () => {
    const { db, dir } = tempDb();
    dirs.push(dir);
    const now = seedOrg(db);
    const repo = openRepo(db);
    const assetSha = sha(20);
    const envelope = importEnvelope(now, "proj-no-resources", [assetSha]);

    expect(() =>
      repo.importSb3CreateProjectAtomic({
        organizationId: "org-1",
        ownerUserId: "user-1",
        projectId: "proj-no-resources",
        title: "No resources",
        envelope,
        assetObjects: [
          {
            sha256: assetSha,
            byteLength: 1024,
            md5Hex: md5(0),
            dataFormat: "png",
          },
        ],
        grantShas: [assetSha],
        releaseImportSessionId: "missing-session",
        fileBytes: 1024,
        now,
      }),
    ).toThrow(/IMPORT_PRECONDITION/);

    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM projects`).get(),
    ).toEqual({ c: 0 });
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM asset_objects`).get(),
    ).toEqual({ c: 0 });
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM organization_asset_grants`).get(),
    ).toEqual({ c: 0 });
    db.close();
  });

  it("importSb3CreateProjectAtomic rejects a non-finite fileBytes measurement", () => {
    const { db, dir } = tempDb();
    dirs.push(dir);
    const now = seedOrg(db);
    const repo = openRepo(db);
    const assetSha = sha(30);
    const sessionId = "invalid-file-bytes";
    createActiveImportResources(repo, {
      importSessionId: sessionId,
      assetObjects: [{ sha256: assetSha, byteLength: 1024 }],
      now,
    });
    let error: unknown;
    try {
      repo.importSb3CreateProjectAtomic({
        organizationId: "org-1",
        ownerUserId: "user-1",
        projectId: "proj-invalid-file-bytes",
        title: "Invalid fileBytes",
        envelope: importEnvelope(now, "proj-invalid-file-bytes", [assetSha]),
        assetObjects: [
          {
            sha256: assetSha,
            byteLength: 1024,
            md5Hex: md5(0),
            dataFormat: "png",
          },
        ],
        grantShas: [assetSha],
        releaseImportSessionId: sessionId,
        fileBytes: Number.NaN,
        now,
      });
    } catch (err) {
      error = err;
    }

    expect(error).toEqual(expect.objectContaining({ name: "RangeError" }));
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM projects`).get(),
    ).toEqual({ c: 0 });
    db.close();
  });

  it("importSb3CreateProjectAtomic rejects fileBytes below active materialized bytes", () => {
    const { db, dir } = tempDb();
    dirs.push(dir);
    const now = seedOrg(db);
    const repo = openRepo(db);
    const assetSha = sha(31);
    const sessionId = "stale-file-bytes";
    createActiveImportResources(repo, {
      importSessionId: sessionId,
      assetObjects: [{ sha256: assetSha, byteLength: 1024 }],
      now,
    });
    repo.materializeGlobalDiskReservation({
      importSessionId: sessionId,
      deltaBytes: 1024,
      now,
    });
    let error: unknown;
    try {
      repo.importSb3CreateProjectAtomic({
        organizationId: "org-1",
        ownerUserId: "user-1",
        projectId: "proj-stale-file-bytes",
        title: "Stale fileBytes",
        envelope: importEnvelope(now, "proj-stale-file-bytes", [assetSha]),
        assetObjects: [
          {
            sha256: assetSha,
            byteLength: 1024,
            md5Hex: md5(0),
            dataFormat: "png",
          },
        ],
        grantShas: [assetSha],
        releaseImportSessionId: sessionId,
        fileBytes: 0,
        now,
      });
    } catch (err) {
      error = err;
    }

    expect(error).toEqual(
      expect.objectContaining({
        name: "StaleFileBytesError",
      }),
    );
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM projects`).get(),
    ).toEqual({ c: 0 });
    db.close();
  });

  it("importSb3CreateProjectAtomic requires every document SHA to be granted", () => {
    const { db, dir } = tempDb();
    dirs.push(dir);
    const now = seedOrg(db);
    const repo = openRepo(db);
    const assetSha = sha(29);
    const sessionId = "missing-grant";
    createActiveImportResources(repo, {
      importSessionId: sessionId,
      assetObjects: [{ sha256: assetSha, byteLength: 1024 }],
      now,
    });

    expect(() =>
      repo.importSb3CreateProjectAtomic({
        organizationId: "org-1",
        ownerUserId: "user-1",
        projectId: "proj-missing-grant",
        title: "Missing grant",
        envelope: importEnvelope(now, "proj-missing-grant", [assetSha]),
        assetObjects: [
          {
            sha256: assetSha,
            byteLength: 1024,
            md5Hex: md5(0),
            dataFormat: "png",
          },
        ],
        grantShas: [],
        releaseImportSessionId: sessionId,
        fileBytes: 1024,
        now,
      }),
    ).toThrow(/IMPORT_PRECONDITION/);
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM projects`).get(),
    ).toEqual({ c: 0 });
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM organization_asset_grants`).get(),
    ).toEqual({ c: 0 });
    db.close();
  });

  it("importSb3CreateProjectAtomic rejects an expired global reservation", () => {
    const { db, dir } = tempDb();
    dirs.push(dir);
    const now = seedOrg(db);
    const repo = openRepo(db);
    const assetSha = sha(21);
    const sessionId = "expired-global";
    createActiveImportResources(repo, {
      importSessionId: sessionId,
      assetObjects: [{ sha256: assetSha, byteLength: 1024 }],
      now,
    });
    db.prepare(
      `UPDATE global_disk_reservations SET expires_at = ?
       WHERE import_session_id = ?`,
    ).run(new Date(Date.parse(now) - 1).toISOString(), sessionId);

    expect(() =>
      repo.importSb3CreateProjectAtomic({
        organizationId: "org-1",
        ownerUserId: "user-1",
        projectId: "proj-expired-global",
        title: "Expired",
        envelope: importEnvelope(now, "proj-expired-global", [assetSha]),
        assetObjects: [
          {
            sha256: assetSha,
            byteLength: 1024,
            md5Hex: md5(0),
            dataFormat: "png",
          },
        ],
        grantShas: [assetSha],
        releaseImportSessionId: sessionId,
        fileBytes: 1024,
        now,
      }),
    ).toThrow(/IMPORT_PRECONDITION/);
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM projects`).get(),
    ).toEqual({ c: 0 });
    db.close();
  });

  it("importSb3CreateProjectAtomic requires a quota reservation for the same organization", () => {
    const { db, dir } = tempDb();
    dirs.push(dir);
    const now = seedOrg(db);
    seedOrg(db, "org-2", now);
    const repo = openRepo(db);
    const assetSha = sha(26);
    const sessionId = "wrong-quota-org";
    repo.createGlobalDiskReservation({
      reservationId: "global-wrong-quota-org",
      importSessionId: sessionId,
      reservedBytes: 128 * M,
      fileBytes: 0,
      now,
    });
    repo.createQuotaReservation({
      reservationId: "quota-wrong-quota-org",
      organizationId: "org-2",
      importSessionId: sessionId,
      shas: [{ sha256: assetSha, byteLength: 1024 }],
      now,
    });
    repo.createImportLeases({
      organizationId: "org-1",
      importSessionId: sessionId,
      leases: [{ leaseId: "lease-wrong-quota-org", sha256: assetSha }],
      now,
    });

    expect(() =>
      repo.importSb3CreateProjectAtomic({
        organizationId: "org-1",
        ownerUserId: "user-1",
        projectId: "proj-wrong-quota-org",
        title: "Wrong quota org",
        envelope: importEnvelope(now, "proj-wrong-quota-org", [assetSha]),
        assetObjects: [
          {
            sha256: assetSha,
            byteLength: 1024,
            md5Hex: md5(0),
            dataFormat: "png",
          },
        ],
        grantShas: [assetSha],
        releaseImportSessionId: sessionId,
        fileBytes: 1024,
        now,
      }),
    ).toThrow(/IMPORT_PRECONDITION/);
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM projects`).get(),
    ).toEqual({ c: 0 });
    db.close();
  });

  it("importSb3CreateProjectAtomic requires the quota reservation SHA set", () => {
    const { db, dir } = tempDb();
    dirs.push(dir);
    const now = seedOrg(db);
    const repo = openRepo(db);
    const assetSha = sha(27);
    const sessionId = "wrong-quota-sha";
    repo.createGlobalDiskReservation({
      reservationId: "global-wrong-quota-sha",
      importSessionId: sessionId,
      reservedBytes: 128 * M,
      fileBytes: 0,
      now,
    });
    repo.createQuotaReservation({
      reservationId: "quota-wrong-quota-sha",
      organizationId: "org-1",
      importSessionId: sessionId,
      shas: [{ sha256: sha(28), byteLength: 1024 }],
      now,
    });
    repo.createImportLeases({
      organizationId: "org-1",
      importSessionId: sessionId,
      leases: [{ leaseId: "lease-wrong-quota-sha", sha256: assetSha }],
      now,
    });

    expect(() =>
      repo.importSb3CreateProjectAtomic({
        organizationId: "org-1",
        ownerUserId: "user-1",
        projectId: "proj-wrong-quota-sha",
        title: "Wrong quota SHA",
        envelope: importEnvelope(now, "proj-wrong-quota-sha", [assetSha]),
        assetObjects: [
          {
            sha256: assetSha,
            byteLength: 1024,
            md5Hex: md5(0),
            dataFormat: "png",
          },
        ],
        grantShas: [assetSha],
        releaseImportSessionId: sessionId,
        fileBytes: 1024,
        now,
      }),
    ).toThrow(/IMPORT_PRECONDITION/);
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM projects`).get(),
    ).toEqual({ c: 0 });
    db.close();
  });

  it("importSb3CreateProjectAtomic requires an active lease for every asset SHA", () => {
    const { db, dir } = tempDb();
    dirs.push(dir);
    const now = seedOrg(db);
    const repo = openRepo(db);
    const assetShas = [sha(22), sha(23)];
    const sessionId = "missing-lease";
    createActiveImportResources(repo, {
      importSessionId: sessionId,
      assetObjects: assetShas.map((sha256) => ({
        sha256,
        byteLength: 1024,
      })),
      now,
    });
    db.prepare(
      `DELETE FROM asset_import_leases WHERE sha256 = ?`,
    ).run(assetShas[1]);

    expect(() =>
      repo.importSb3CreateProjectAtomic({
        organizationId: "org-1",
        ownerUserId: "user-1",
        projectId: "proj-missing-lease",
        title: "Missing lease",
        envelope: importEnvelope(now, "proj-missing-lease", assetShas),
        assetObjects: assetShas.map((sha256, index) => ({
          sha256,
          byteLength: 1024,
          md5Hex: md5(index),
          dataFormat: "png" as const,
        })),
        grantShas: assetShas,
        releaseImportSessionId: sessionId,
        fileBytes: 2048,
        now,
      }),
    ).toThrow(/IMPORT_PRECONDITION/);
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM projects`).get(),
    ).toEqual({ c: 0 });
    db.close();
  });

  it.each(["quarantining", "quarantined"] as const)(
    "importSb3CreateProjectAtomic rejects an existing %s asset",
    (gcState) => {
      const { db, dir } = tempDb();
      dirs.push(dir);
      const now = seedOrg(db);
      const repo = openRepo(db);
      const assetSha = sha(gcState === "quarantining" ? 24 : 25);
      const sessionId = `state-${gcState}`;
      db.prepare(
        `INSERT INTO asset_objects (
          sha256, byte_length, md5_hex, data_format, gc_state, created_at
        ) VALUES (?, ?, ?, 'png', ?, ?)`,
      ).run(assetSha, 1024, md5(0), gcState, now);
      createActiveImportResources(repo, {
        importSessionId: sessionId,
        assetObjects: [{ sha256: assetSha, byteLength: 1024 }],
        now,
      });

      expect(() =>
        repo.importSb3CreateProjectAtomic({
          organizationId: "org-1",
          ownerUserId: "user-1",
          projectId: `proj-${gcState}`,
          title: gcState,
          envelope: importEnvelope(now, `proj-${gcState}`, [assetSha]),
          assetObjects: [
            {
              sha256: assetSha,
              byteLength: 1024,
              md5Hex: md5(0),
              dataFormat: "png",
            },
          ],
          grantShas: [assetSha],
          releaseImportSessionId: sessionId,
          fileBytes: 1024,
          now,
        }),
      ).toThrow(/ASSET_NOT_LIVE/);

      expect(
        db.prepare(`SELECT COUNT(*) AS c FROM projects`).get(),
      ).toEqual({ c: 0 });
      expect(
        db.prepare(`SELECT COUNT(*) AS c FROM organization_asset_grants`).get(),
      ).toEqual({ c: 0 });
      db.close();
    },
  );

  it.each([
    ["byte_length", 2048, md5(0), "png"],
    ["md5_hex", 1024, md5(9), "png"],
    ["data_format", 1024, md5(0), "jpg"],
  ] as const)(
    "importSb3CreateProjectAtomic rejects existing asset %s mismatch",
    (_field, byteLength, md5Hex, dataFormat) => {
      const { db, dir } = tempDb();
      dirs.push(dir);
      const now = seedOrg(db);
      const repo = openRepo(db);
      const assetSha = sha(byteLength + md5Hex.charCodeAt(0) + dataFormat.length);
      const sessionId = `metadata-${_field}`;
      db.prepare(
        `INSERT INTO asset_objects (
          sha256, byte_length, md5_hex, data_format, gc_state, created_at
        ) VALUES (?, ?, ?, ?, 'live', ?)`,
      ).run(assetSha, byteLength, md5Hex, dataFormat, now);
      createActiveImportResources(repo, {
        importSessionId: sessionId,
        assetObjects: [{ sha256: assetSha, byteLength: 1024 }],
        now,
      });

      expect(() =>
        repo.importSb3CreateProjectAtomic({
          organizationId: "org-1",
          ownerUserId: "user-1",
          projectId: `proj-${_field}`,
          title: _field,
          envelope: importEnvelope(now, `proj-${_field}`, [assetSha]),
          assetObjects: [
            {
              sha256: assetSha,
              byteLength: 1024,
              md5Hex: md5(0),
              dataFormat: "png",
            },
          ],
          grantShas: [assetSha],
          releaseImportSessionId: sessionId,
          fileBytes: 1024,
          now,
        }),
      ).toThrow(/ASSET_METADATA_MISMATCH/);

      expect(
        db.prepare(`SELECT COUNT(*) AS c FROM projects`).get(),
      ).toEqual({ c: 0 });
      expect(
        db.prepare(`SELECT COUNT(*) AS c FROM organization_asset_grants`).get(),
      ).toEqual({ c: 0 });
      db.close();
    },
  );

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
      shas: [{ sha256: assetSha, byteLength: 1024 }],
      now,
    });
    repo.createImportLeases({
      organizationId: "org-1",
      importSessionId: "import-over",
      leases: [{ leaseId: "lease-over", sha256: assetSha }],
      now,
    });
    const expiresAt = new Date(Date.parse(now) + RESERVATION_TTL_MS).toISOString();
    db.prepare(
      `INSERT INTO organization_asset_quota_reservations (
        reservation_id, organization_id, import_session_id, reserved_bytes,
        expires_at, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      "other-active-quota",
      "org-1",
      "other-import",
      ORG_QUOTA_BYTES,
      expiresAt,
      now,
    );
    db.prepare(
      `INSERT INTO organization_asset_quota_reservation_shas (
        reservation_id, sha256, byte_length
      ) VALUES (?, ?, ?)`,
    ).run("other-active-quota", sha(4), ORG_QUOTA_BYTES);

    const envelope = importEnvelope(now, "proj-over", [assetSha]);

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
