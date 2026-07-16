import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import {
  AssetNotGrantedError,
  AssetRefMismatchError,
  type CommitAssetExpectation,
} from "@blocksync/project-service";
import {
  createSqliteCommitAssetGuard,
  migrate,
  migrateAssets,
  migrateAuth,
} from "./index.js";

function sha(n: number): string {
  return n.toString(16).padStart(64, "0").slice(-64);
}

function md5(n: number): string {
  return n.toString(16).padStart(32, "a").slice(-32);
}

function tempDb(): { db: Database.Database; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "commit-guard-"));
  const db = new Database(join(dir, "test.sqlite"));
  migrate(db);
  migrateAuth(db);
  migrateAssets(db);
  return { db, dir };
}

function seedAsset(
  db: Database.Database,
  args: {
    sha256: string;
    byteLength: number;
    md5Hex: string;
    dataFormat: string;
    gcState?: "live" | "quarantining" | "quarantined";
  },
  now: string,
): void {
  db.prepare(
    `INSERT INTO asset_objects (
      sha256, byte_length, md5_hex, data_format, gc_state, created_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    args.sha256,
    args.byteLength,
    args.md5Hex,
    args.dataFormat,
    args.gcState ?? "live",
    now,
  );
}

describe("createSqliteCommitAssetGuard", () => {
  const dirs: string[] = [];
  const dbs: Database.Database[] = [];

  afterEach(() => {
    while (dbs.length > 0) {
      dbs.pop()!.close();
    }
    while (dirs.length > 0) {
      rmSync(dirs.pop()!, { recursive: true, force: true });
    }
  });

  function openGuard(): {
    db: Database.Database;
    guard: ReturnType<typeof createSqliteCommitAssetGuard>;
    now: string;
  } {
    const { db, dir } = tempDb();
    dirs.push(dir);
    dbs.push(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO organizations (id, name, status, created_at) VALUES (?, ?, 'active', ?)`,
    ).run("org-1", "Test Org", now);
    return { db, guard: createSqliteCommitAssetGuard(db), now };
  }

  function grantAsset(
    db: Database.Database,
    organizationId: string,
    sha256: string,
    grantedAt: string,
  ): void {
    db.prepare(
      `INSERT INTO organization_asset_grants (organization_id, sha256, granted_at)
       VALUES (?, ?, ?)`,
    ).run(organizationId, sha256, grantedAt);
  }

  it("rejects DB md5_hex mismatch at commit", () => {
    const { db, guard, now } = openGuard();

    const assetSha = sha(1);
    seedAsset(
      db,
      {
        sha256: assetSha,
        byteLength: 128,
        md5Hex: md5(1),
        dataFormat: "png",
      },
      now,
    );
    grantAsset(db, "org-1", assetSha, now);

    const expectations: CommitAssetExpectation[] = [
      {
        sha256: assetSha,
        md5Hex: md5(2),
        dataFormat: "png",
        byteLength: 128,
      },
    ];

    expect(() => guard.assertLiveGrantsInCommit("org-1", expectations)).toThrow(
      AssetRefMismatchError,
    );
  });

  it("rejects DB data_format mismatch at commit", () => {
    const { db, guard, now } = openGuard();

    const assetSha = sha(2);
    seedAsset(
      db,
      {
        sha256: assetSha,
        byteLength: 128,
        md5Hex: md5(2),
        dataFormat: "png",
      },
      now,
    );
    grantAsset(db, "org-1", assetSha, now);

    expect(() =>
      guard.assertLiveGrantsInCommit("org-1", [
        {
          sha256: assetSha,
          md5Hex: md5(2),
          dataFormat: "svg",
          byteLength: 128,
        },
      ]),
    ).toThrow(AssetRefMismatchError);
  });

  it("rejects DB byte_length mismatch at commit", () => {
    const { db, guard, now } = openGuard();

    const assetSha = sha(3);
    seedAsset(
      db,
      {
        sha256: assetSha,
        byteLength: 128,
        md5Hex: md5(3),
        dataFormat: "png",
      },
      now,
    );
    grantAsset(db, "org-1", assetSha, now);

    expect(() =>
      guard.assertLiveGrantsInCommit("org-1", [
        {
          sha256: assetSha,
          md5Hex: md5(3),
          dataFormat: "png",
          byteLength: 256,
        },
      ]),
    ).toThrow(AssetRefMismatchError);
  });

  it("rejects missing org grant after metadata matches", () => {
    const { db, guard, now } = openGuard();

    const assetSha = sha(4);
    seedAsset(
      db,
      {
        sha256: assetSha,
        byteLength: 64,
        md5Hex: md5(4),
        dataFormat: "wav",
      },
      now,
    );

    expect(() =>
      guard.assertLiveGrantsInCommit("org-1", [
        {
          sha256: assetSha,
          md5Hex: md5(4),
          dataFormat: "wav",
          byteLength: 64,
        },
      ]),
    ).toThrow(AssetNotGrantedError);
  });
});
