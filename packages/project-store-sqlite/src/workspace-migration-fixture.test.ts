import {mkdtempSync, readdirSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import Database from "better-sqlite3";
import {afterEach, describe, expect, it} from "vitest";
import {
  copyLegacyR1Fixture,
  readLegacyR1Manifest,
} from "./fixtures/legacy-r1-manifest.js";
import {openSqliteStore} from "./store.js";

const roots: string[] = [];
const fixtureDir = dirname(
  fileURLToPath(new URL("./fixtures/legacy-r1.sqlite", import.meta.url)),
);

function assertNoProjectsSqliteSidecars(directory: string): void {
  const names = new Set(readdirSync(directory));
  expect(names.has("projects.sqlite-wal")).toBe(false);
  expect(names.has("projects.sqlite-shm")).toBe(false);
}

function foreignKeyViolations(dbPath: string): unknown[] {
  const db = new Database(dbPath, {readonly: true});
  try {
    return db.prepare("PRAGMA foreign_key_check").all();
  } finally {
    db.close();
  }
}

describe("legacy R1 workspace migration fixture copy/reopen", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, {recursive: true, force: true});
    }
  });

  it("copies and reopens the committed fixture without mutating evidence", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "legacy-r1-copy-"));
    roots.push(tempDir);

    const copied = copyLegacyR1Fixture(tempDir);
    const before = readLegacyR1Manifest(copied.dbPath, copied.snapshotDir);
    const store = openSqliteStore({dbPath: copied.dbPath});
    store.close();
    const after = readLegacyR1Manifest(copied.dbPath, copied.snapshotDir);

    expect(after.revisions).toEqual(before.revisions);
    expect(after.snapshots).toEqual(before.snapshots);
    expect(after.snapshotSha256).toEqual(before.snapshotSha256);
    expect(after.revisions.find(row => row.revision === 1)).toMatchObject({
      // Independent sentinel pinned by v1-envelope-hash.regression.test.ts.
      contentHash:
        "082c3d00ac85531a4e88689c13d1088137569a4fc5bc591b1797871c9cf13128",
      clientTransactionId: "tx-legacy-rich",
    });

    expect(foreignKeyViolations(copied.dbPath)).toEqual([]);

    const checkpoint = new Database(copied.dbPath);
    try {
      checkpoint.pragma("wal_checkpoint(TRUNCATE)");
    } finally {
      checkpoint.close();
    }

    assertNoProjectsSqliteSidecars(fixtureDir);
    assertNoProjectsSqliteSidecars(tempDir);
  });
});
