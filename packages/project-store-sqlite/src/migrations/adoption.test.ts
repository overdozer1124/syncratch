import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import Database from "better-sqlite3";
import {afterEach, describe, expect, it} from "vitest";
import {copyLegacyR1Fixture, readLegacyR1Manifest} from "../fixtures/legacy-r1-manifest.js";
import {openSqliteStore} from "../store.js";
import {r1BaselineMigration} from "./0001-r1-baseline.js";
import {configureSqliteConnection} from "./configure.js";
import {runSchemaMigrations} from "./index.js";
import {
  captureSchemaFingerprint,
  classifyLedgerlessDatabase,
} from "./schema-fingerprint.js";
import {runSchemaMigrationsWithOptions} from "./runner.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, {recursive: true, force: true});
  }
});

function copyFixture(): ReturnType<typeof copyLegacyR1Fixture> {
  const root = mkdtempSync(join(tmpdir(), "blocksync-adoption-"));
  roots.push(root);
  return copyLegacyR1Fixture(root);
}

function ledgerRows(db: Database.Database): unknown[] {
  return db
    .prepare(
      `SELECT version, name, checksum, applied_at
       FROM schema_migrations ORDER BY version`,
    )
    .all();
}

function tableExists(db: Database.Database, name: string): boolean {
  return (
    db
      .prepare(
        `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`,
      )
      .get(name) !== undefined
  );
}

function rowEvidence(db: Database.Database): unknown[] {
  const tables = db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
         AND name <> 'schema_migrations'
       ORDER BY name`,
    )
    .pluck()
    .all() as string[];
  return tables.map(table => ({
    table,
    rows: db.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}"`).all(),
  }));
}

describe("ledgerless R1 adoption", () => {
  it("adopts the accepted current fixture without changing schema or logical evidence", () => {
    const copied = copyFixture();
    const before = readLegacyR1Manifest(copied.dbPath, copied.snapshotDir);
    const db = new Database(copied.dbPath);
    try {
      const beforeFingerprint = captureSchemaFingerprint(db);
      const beforeRows = rowEvidence(db);

      configureSqliteConnection(db);
      runSchemaMigrations(db);

      expect(db.pragma("user_version", {simple: true})).toBe(1);
      expect(
        db
          .prepare("SELECT version, name FROM schema_migrations")
          .all(),
      ).toEqual([{version: 1, name: "r1-baseline"}]);
      expect(captureSchemaFingerprint(db)).toEqual(beforeFingerprint);
      expect(rowEvidence(db)).toEqual(beforeRows);
    } finally {
      db.close();
    }

    const after = readLegacyR1Manifest(copied.dbPath, copied.snapshotDir);
    const {databaseSha256: _before, ...beforeEvidence} = before;
    const {databaseSha256: _after, ...afterEvidence} = after;
    expect(afterEvidence).toEqual(beforeEvidence);
  });

  it("patches only generation when adopting the accepted pre-generation fixture and is idempotent", () => {
    const copied = copyFixture();
    const db = new Database(copied.dbPath);
    try {
      db.exec("ALTER TABLE asset_gc_lock DROP COLUMN generation");
      expect(classifyLedgerlessDatabase(db)).toEqual({kind: "pre_generation"});
      const beforeRows = rowEvidence(db);

      configureSqliteConnection(db);
      runSchemaMigrations(db);

      expect(rowEvidence(db)).toEqual(beforeRows);
      expect(
        db
          .prepare(
            "SELECT name FROM pragma_table_info('asset_gc_lock') ORDER BY cid",
          )
          .pluck()
          .all(),
      ).toEqual(["id", "owner", "acquired_at", "expires_at", "generation"]);
      expect(db.pragma("user_version", {simple: true})).toBe(1);
      const firstLedger = ledgerRows(db);
      const firstFingerprint = captureSchemaFingerprint(db);

      runSchemaMigrations(db);

      expect(ledgerRows(db)).toEqual(firstLedger);
      expect(captureSchemaFingerprint(db)).toEqual(firstFingerprint);
    } finally {
      db.close();
    }
  });

  it.each([
    ["extra table", (db: Database.Database) => db.exec("CREATE TABLE unexpected(id TEXT)")],
    [
      "pre-generation plus an extra table",
      (db: Database.Database) =>
        db.exec(`
          ALTER TABLE asset_gc_lock DROP COLUMN generation;
          CREATE TABLE unexpected(id TEXT);
        `),
    ],
    ["missing table", (db: Database.Database) => db.exec("DROP TABLE asset_import_leases")],
    ["extra column", (db: Database.Database) => db.exec("ALTER TABLE asset_gc_lock ADD COLUMN unexpected TEXT")],
    [
      "changed CHECK",
      (db: Database.Database) =>
        db.exec(`
          ALTER TABLE asset_gc_lock RENAME TO asset_gc_lock_old;
          CREATE TABLE asset_gc_lock (
            id INTEGER PRIMARY KEY CHECK (id <= 1),
            owner TEXT NOT NULL,
            generation INTEGER NOT NULL DEFAULT 1,
            acquired_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
          );
          INSERT INTO asset_gc_lock SELECT * FROM asset_gc_lock_old;
          DROP TABLE asset_gc_lock_old;
        `),
    ],
    [
      "unknown explicit index",
      (db: Database.Database) =>
        db.exec("CREATE INDEX unexpected_asset_owner ON asset_gc_lock(owner)"),
    ],
  ])("rejects an unknown ledgerless schema with %s without writes", (_name, mutate) => {
    const copied = copyFixture();
    const db = new Database(copied.dbPath);
    try {
      mutate(db);
      const beforeFingerprint = captureSchemaFingerprint(db);
      const beforeRows = rowEvidence(db);

      configureSqliteConnection(db);
      expect(() => runSchemaMigrations(db)).toThrowError(
        expect.objectContaining({
          name: "SchemaMigrationError",
          code: "SCHEMA_UNKNOWN_LEGACY",
        }),
      );

      expect(tableExists(db, "schema_migrations")).toBe(false);
      expect(captureSchemaFingerprint(db)).toEqual(beforeFingerprint);
      expect(rowEvidence(db)).toEqual(beforeRows);
      expect(db.pragma("user_version", {simple: true})).toBe(0);
    } finally {
      db.close();
    }
  });

  it("captures now once before locking and reclassifies the resulting schema inside the transaction", () => {
    const copied = copyFixture();
    const db = new Database(copied.dbPath);
    try {
      let calls = 0;
      runSchemaMigrationsWithOptions(db, {
        migrations: [r1BaselineMigration],
        now: () => {
          calls += 1;
          db.exec("ALTER TABLE asset_gc_lock DROP COLUMN generation");
          return "2026-07-17T00:00:00.000Z";
        },
      });

      expect(calls).toBe(1);
      expect(
        db
          .prepare(
            "SELECT name FROM pragma_table_info('asset_gc_lock') ORDER BY cid",
          )
          .pluck()
          .all(),
      ).toEqual(["id", "owner", "acquired_at", "expires_at", "generation"]);
      expect(ledgerRows(db)).toEqual([
        {
          version: 1,
          name: "r1-baseline",
          checksum: r1BaselineMigration.checksum,
          applied_at: "2026-07-17T00:00:00.000Z",
        },
      ]);
    } finally {
      db.close();
    }
  });
});

describe("store startup", () => {
  it("closes its shared connection when migration startup fails", () => {
    const root = mkdtempSync(join(tmpdir(), "blocksync-startup-close-"));
    roots.push(root);
    const dbPath = join(root, "unknown.sqlite");
    const seed = new Database(dbPath);
    seed.exec("CREATE TABLE partial(id TEXT)");
    seed.close();

    expect(() => openSqliteStore({dbPath})).toThrowError(
      expect.objectContaining({code: "SCHEMA_UNKNOWN_LEGACY"}),
    );

    const verifier = new Database(dbPath);
    try {
      verifier.exec("BEGIN IMMEDIATE");
      verifier.exec("CREATE TABLE write_lock_proof(id TEXT)");
      verifier.exec("COMMIT");
    } finally {
      if (verifier.inTransaction) verifier.exec("ROLLBACK");
      verifier.close();
    }
  });
});
