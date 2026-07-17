import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  createSqliteAssetRepository,
  migrate,
  migrateAssets,
  migrateAuth,
  QUARANTINE_GRACE_MS,
} from "./index.js";

function sha(n: number): string {
  return n.toString(16).padStart(64, "0").slice(-64);
}

function md5(n: number): string {
  return n.toString(16).padStart(32, "a").slice(-32);
}

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
});

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "asset-gc-"));
  dirs.push(dir);
  const db = new Database(join(dir, "test.sqlite"));
  migrate(db);
  migrateAuth(db);
  migrateAssets(db);
  db.prepare(
    `INSERT INTO organizations (id, name, status, created_at) VALUES ('org-1', 'Org', 'active', ?)`,
  ).run(new Date().toISOString());
  return { db, dir };
}

function insertLiveAsset(
  db: Database.Database,
  assetSha: string,
  now: string,
): void {
  db.prepare(
    `INSERT INTO asset_objects (
      sha256, byte_length, md5_hex, data_format, gc_state, created_at
    ) VALUES (?, 128, ?, 'png', 'live', ?)`,
  ).run(assetSha, md5(1), now);
  db.prepare(
    `INSERT INTO organization_asset_grants (organization_id, sha256, granted_at)
     VALUES ('org-1', ?, ?)`,
  ).run(assetSha, now);
}

describe("asset GC repository", () => {
  it("lists only unreferenced live shas as GC candidates", () => {
    const { db } = tempDb();
    const now = new Date().toISOString();
    const repo = createSqliteAssetRepository(db);
    const referenced = sha(1);
    const orphan = sha(2);
    insertLiveAsset(db, referenced, now);
    insertLiveAsset(db, orphan, now);
    db.prepare(
      `INSERT INTO projects (
        id, organization_id, owner_user_id, title, head_revision, created_at, updated_at
      ) VALUES ('p1', 'org-1', 'u1', 'T', 0, ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO project_revisions (
        project_id, revision, envelope_json, content_hash, request_hash,
        actor_user_id, created_at
      ) VALUES ('p1', 0, ?, 'h', 'r', 'u1', ?)`,
    ).run(
      JSON.stringify({
        document: {
          targets: [
            {
              costumes: [{ contentSha256: referenced }],
            },
          ],
        },
      }),
      now,
    );

    expect(repo.listGcCandidateShas(now, [referenced])).toEqual([orphan]);
    db.close();
  });

  it("skips quarantine when sha is referenced by active lease", () => {
    const { db } = tempDb();
    const now = new Date().toISOString();
    const repo = createSqliteAssetRepository(db);
    const assetSha = sha(3);
    insertLiveAsset(db, assetSha, now);

    const expiresAt = new Date(Date.parse(now) + 15 * 60 * 1000).toISOString();
    db.prepare(
      `INSERT INTO asset_import_leases (
        lease_id, organization_id, sha256, import_session_id, created_at, expires_at
      ) VALUES ('lease-1', 'org-1', ?, 'sess-1', ?, ?)`,
    ).run(assetSha, now, expiresAt);

    expect(repo.beginAssetQuarantine(assetSha, now, [])).toBe("skipped");
    expect(
      db.prepare(`SELECT gc_state AS s FROM asset_objects WHERE sha256 = ?`).get(
        assetSha,
      ),
    ).toEqual({ s: "live" });
    db.close();
  });

  it("marks unreferenced sha quarantining and removes grants", () => {
    const { db } = tempDb();
    const now = new Date().toISOString();
    const repo = createSqliteAssetRepository(db);
    const assetSha = sha(4);
    insertLiveAsset(db, assetSha, now);

    expect(repo.beginAssetQuarantine(assetSha, now, [])).toBe("started");
    repo.finishAssetQuarantineAfterRename(assetSha, {
      moved: true,
      liveHadFile: true,
      quarantineHadFile: false,
    }, now);

    expect(
      db.prepare(`SELECT gc_state AS s FROM asset_objects WHERE sha256 = ?`).get(
        assetSha,
      ),
    ).toEqual({ s: "quarantined" });
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM organization_asset_grants`).get(),
    ).toEqual({ c: 0 });
    db.close();
  });

  it("reconcile quarantining with live file present restores live state", () => {
    const { db } = tempDb();
    const now = new Date().toISOString();
    const repo = createSqliteAssetRepository(db);
    const assetSha = sha(5);
    insertLiveAsset(db, assetSha, now);
    db.prepare(`UPDATE asset_objects SET gc_state = 'quarantining' WHERE sha256 = ?`).run(
      assetSha,
    );
    db.prepare(`DELETE FROM organization_asset_grants WHERE sha256 = ?`).run(assetSha);
    db.prepare(
      `INSERT INTO projects (
        id, organization_id, owner_user_id, title, head_revision, created_at, updated_at
      ) VALUES ('p1', 'org-1', 'u1', 'T', 0, ?, ?)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO project_revisions (
        project_id, revision, envelope_json, content_hash, request_hash,
        actor_user_id, created_at
      ) VALUES ('p1', 0, ?, 'h', 'r', 'u1', ?)`,
    ).run(
      JSON.stringify({
        document: {
          targets: [{ costumes: [{ contentSha256: assetSha }] }],
        },
      }),
      now,
    );

    expect(
      repo.reconcileQuarantiningRow({
        sha256: assetSha,
        readFsState: () => ({ liveExists: true, quarantineExists: false }),
        now,
        snapshotDocumentShas: [assetSha],
        snapshotOrganizationIds: ["org-1"],
      }),
    ).toBe("restored-live");

    expect(
      db.prepare(`SELECT gc_state AS s FROM asset_objects WHERE sha256 = ?`).get(
        assetSha,
      ),
    ).toEqual({ s: "live" });
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM organization_asset_grants`).get(),
    ).toEqual({ c: 1 });
    db.close();
  });

  it("reconcile quarantining with live file keeps quarantining when unreferenced", () => {
    const { db } = tempDb();
    const now = new Date().toISOString();
    const repo = createSqliteAssetRepository(db);
    const assetSha = sha(6);
    insertLiveAsset(db, assetSha, now);
    db.prepare(`UPDATE asset_objects SET gc_state = 'quarantining' WHERE sha256 = ?`).run(
      assetSha,
    );
    db.prepare(`DELETE FROM organization_asset_grants WHERE sha256 = ?`).run(assetSha);

    expect(
      repo.reconcileQuarantiningRow({
        sha256: assetSha,
        readFsState: () => ({ liveExists: true, quarantineExists: false }),
        now,
        snapshotDocumentShas: [],
        snapshotOrganizationIds: [],
      }),
    ).toBe("kept-quarantining");

    expect(
      db.prepare(`SELECT gc_state AS s FROM asset_objects WHERE sha256 = ?`).get(
        assetSha,
      ),
    ).toEqual({ s: "quarantining" });
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM organization_asset_grants WHERE sha256 = ?`).get(
        assetSha,
      ),
    ).toEqual({ c: 0 });
    db.close();
  });

  it("reconcile dual presence marks unreferenced quarantined", () => {
    const { db } = tempDb();
    const now = new Date().toISOString();
    const repo = createSqliteAssetRepository(db);
    const assetSha = sha(10);
    insertLiveAsset(db, assetSha, now);
    db.prepare(`UPDATE asset_objects SET gc_state = 'quarantining' WHERE sha256 = ?`).run(
      assetSha,
    );
    db.prepare(`DELETE FROM organization_asset_grants WHERE sha256 = ?`).run(assetSha);

    expect(
      repo.reconcileQuarantiningRow({
        sha256: assetSha,
        readFsState: () => ({ liveExists: true, quarantineExists: true }),
        now,
        snapshotDocumentShas: [],
        snapshotOrganizationIds: [],
      }),
    ).toBe("marked-quarantined");

    expect(
      db.prepare(`SELECT gc_state AS s FROM asset_objects WHERE sha256 = ?`).get(
        assetSha,
      ),
    ).toEqual({ s: "quarantined" });
    db.close();
  });

  it("does not revert to live when rename failed with no live file", () => {
    const { db } = tempDb();
    const now = new Date().toISOString();
    const repo = createSqliteAssetRepository(db);
    const assetSha = sha(7);
    insertLiveAsset(db, assetSha, now);
    db.prepare(`UPDATE asset_objects SET gc_state = 'quarantining' WHERE sha256 = ?`).run(
      assetSha,
    );

    repo.finishAssetQuarantineAfterRename(
      assetSha,
      {
        moved: false,
        liveHadFile: false,
        quarantineHadFile: false,
      },
      now,
    );

    expect(
      db.prepare(`SELECT gc_state AS s FROM asset_objects WHERE sha256 = ?`).get(
        assetSha,
      ),
    ).toEqual({ s: "quarantining" });
    db.close();
  });

  it("reconcile quarantined row deletes row when both files missing", () => {
    const { db } = tempDb();
    const now = new Date().toISOString();
    const repo = createSqliteAssetRepository(db);
    const assetSha = sha(8);
    db.prepare(
      `INSERT INTO asset_objects (
        sha256, byte_length, md5_hex, data_format, gc_state, quarantine_started_at, created_at
      ) VALUES (?, 128, ?, 'png', 'quarantined', ?, ?)`,
    ).run(assetSha, md5(1), now, now);

    expect(
      repo.reconcileQuarantinedRow({
        sha256: assetSha,
        readFsState: () => ({ liveExists: false, quarantineExists: false }),
      }),
    ).toBe("deleted");
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM asset_objects WHERE sha256 = ?`).get(
        assetSha,
      ),
    ).toEqual({ c: 0 });
    db.close();
  });

  it("keeps referenced quarantining row when both files are missing", () => {
    const { db } = tempDb();
    const now = new Date().toISOString();
    const repo = createSqliteAssetRepository(db);
    const assetSha = sha(9);
    insertLiveAsset(db, assetSha, now);
    db.prepare(`UPDATE asset_objects SET gc_state = 'quarantining' WHERE sha256 = ?`).run(
      assetSha,
    );
    db.prepare(`DELETE FROM organization_asset_grants WHERE sha256 = ?`).run(assetSha);

    expect(
      repo.reconcileQuarantiningRow({
        sha256: assetSha,
        readFsState: () => ({ liveExists: false, quarantineExists: false }),
        now,
        snapshotDocumentShas: [assetSha],
        snapshotOrganizationIds: ["org-1"],
      }),
    ).toBe("kept-quarantining");

    expect(
      db.prepare(`SELECT gc_state AS s FROM asset_objects WHERE sha256 = ?`).get(
        assetSha,
      ),
    ).toEqual({ s: "quarantining" });
    expect(
      db.prepare(`SELECT COUNT(*) AS c FROM organization_asset_grants WHERE sha256 = ?`).get(
        assetSha,
      ),
    ).toEqual({ c: 0 });
    db.close();
  });

  it("deletes quarantined rows after grace period", () => {
    const { db } = tempDb();
    const now = new Date().toISOString();
    const repo = createSqliteAssetRepository(db);
    const assetSha = sha(6);
    const started = new Date(Date.parse(now) - QUARANTINE_GRACE_MS - 1000).toISOString();
    db.prepare(
      `INSERT INTO asset_objects (
        sha256, byte_length, md5_hex, data_format, gc_state, quarantine_started_at, created_at
      ) VALUES (?, 128, ?, 'png', 'quarantined', ?, ?)`,
    ).run(assetSha, md5(1), started, now);

    expect(repo.listQuarantinedReadyForDeletion(now)).toEqual([assetSha]);
    expect(repo.deleteAssetObjectRow(assetSha)).toBe(true);
    db.close();
  });
});
