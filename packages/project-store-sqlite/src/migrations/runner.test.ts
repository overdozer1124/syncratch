import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import Database from "better-sqlite3";
import {afterEach, describe, expect, it} from "vitest";
import {r1BaselineMigration} from "./0001-r1-baseline.js";
import {computeMigrationChecksum} from "./checksum.js";
import {configureSqliteConnection} from "./configure.js";
import {captureSchemaFingerprint} from "./schema-fingerprint.js";
import {
  type MigrationFaultPoint,
  runSchemaMigrationsWithOptions,
} from "./runner.js";
import {SchemaMigrationError, type SchemaMigration} from "./types.js";

const dbs: Database.Database[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const tempDir of tempDirs.splice(0)) {
    rmSync(tempDir, {recursive: true, force: true});
  }
});

function openMemory(): Database.Database {
  const db = new Database(":memory:");
  dbs.push(db);
  configureSqliteConnection(db);
  return db;
}

function openFileDb(): {db: Database.Database; dbPath: string} {
  const tempDir = mkdtempSync(join(tmpdir(), "blocksync-runner-"));
  tempDirs.push(tempDir);
  const dbPath = join(tempDir, "store.sqlite");
  const db = new Database(dbPath);
  dbs.push(db);
  configureSqliteConnection(db);
  return {db, dbPath};
}

function ledgerRows(db: Database.Database) {
  return db
    .prepare(
      `SELECT version, name, checksum, applied_at
       FROM schema_migrations ORDER BY version`,
    )
    .all();
}

function masterSnapshot(db: Database.Database) {
  return db
    .prepare(
      `SELECT type, name, tbl_name, sql
       FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%'
       ORDER BY type, name`,
    )
    .all();
}

function tableExists(db: Database.Database, name: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?`,
    )
    .get(name) as {ok: number} | undefined;
  return row !== undefined;
}

function createMigration(partial: {
  version: number;
  name: string;
  apply: (db: Database.Database) => void;
  checksumSource?: string;
}): SchemaMigration {
  const checksumSource =
    partial.checksumSource ??
    `version=${partial.version}\nname=${partial.name}\nbody`;
  return {
    version: partial.version,
    name: partial.name,
    checksumSource,
    checksum: computeMigrationChecksum(checksumSource),
    apply: partial.apply,
  };
}

function seedValidV1(db: Database.Database): void {
  runSchemaMigrationsWithOptions(db, {
    migrations: [r1BaselineMigration],
    now: () => "2026-07-17T00:00:00.000Z",
  });
}

describe("runSchemaMigrationsWithOptions", () => {
  it("applies the baseline on a fresh database and is a no-op on reopen", () => {
    const db = openMemory();

    runSchemaMigrationsWithOptions(db, {
      migrations: [r1BaselineMigration],
      now: () => "2026-07-17T00:00:00.000Z",
    });

    expect(ledgerRows(db)).toEqual([
      {
        version: 1,
        name: "r1-baseline",
        checksum: r1BaselineMigration.checksum,
        applied_at: "2026-07-17T00:00:00.000Z",
      },
    ]);
    expect(db.pragma("user_version", {simple: true})).toBe(1);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);

    const fingerprintAfterFirst = captureSchemaFingerprint(db);

    runSchemaMigrationsWithOptions(db, {
      migrations: [r1BaselineMigration],
      now: () => "2099-01-01T00:00:00.000Z",
    });

    expect(ledgerRows(db)).toEqual([
      {
        version: 1,
        name: "r1-baseline",
        checksum: r1BaselineMigration.checksum,
        applied_at: "2026-07-17T00:00:00.000Z",
      },
    ]);
    expect(db.pragma("user_version", {simple: true})).toBe(1);
    expect(captureSchemaFingerprint(db)).toEqual(fingerprintAfterFirst);
  });

  it("rejects a non-empty ledgerless database without writing", () => {
    const db = openMemory();
    db.exec("CREATE TABLE unexpected(id TEXT)");
    const beforeMaster = masterSnapshot(db);
    const beforeUserVersion = db.pragma("user_version", {simple: true});

    expect(() =>
      runSchemaMigrationsWithOptions(db, {
        migrations: [r1BaselineMigration],
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "SchemaMigrationError",
        code: "SCHEMA_UNKNOWN_LEGACY",
      }),
    );

    expect(tableExists(db, "schema_migrations")).toBe(false);
    expect(masterSnapshot(db)).toEqual(beforeMaster);
    expect(db.pragma("user_version", {simple: true})).toBe(beforeUserVersion);
  });

  it("rejects ledger gaps without additional writes", () => {
    const db = openMemory();
    seedValidV1(db);
    db.exec("DELETE FROM schema_migrations");
    db.prepare(
      `INSERT INTO schema_migrations(version, name, checksum, applied_at)
       VALUES (?, ?, ?, ?)`,
    ).run(
      2,
      "ghost",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "2026-07-17T00:00:00.000Z",
    );

    const beforeLedger = ledgerRows(db);
    const beforeMaster = masterSnapshot(db);

    expect(() =>
      runSchemaMigrationsWithOptions(db, {
        migrations: [r1BaselineMigration],
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "SchemaMigrationError",
        code: "SCHEMA_LEDGER_GAP",
      }),
    );

    expect(ledgerRows(db)).toEqual(beforeLedger);
    expect(masterSnapshot(db)).toEqual(beforeMaster);
  });

  it("rejects name mismatch without additional writes", () => {
    const db = openMemory();
    seedValidV1(db);
    db.prepare(`UPDATE schema_migrations SET name = ? WHERE version = 1`).run(
      "renamed",
    );

    const beforeLedger = ledgerRows(db);
    const beforeMaster = masterSnapshot(db);

    expect(() =>
      runSchemaMigrationsWithOptions(db, {
        migrations: [r1BaselineMigration],
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "SchemaMigrationError",
        code: "SCHEMA_LEDGER_MISMATCH",
      }),
    );

    expect(ledgerRows(db)).toEqual(beforeLedger);
    expect(masterSnapshot(db)).toEqual(beforeMaster);
  });

  it("rejects checksum mismatch without additional writes", () => {
    const db = openMemory();
    seedValidV1(db);
    db.prepare(
      `UPDATE schema_migrations SET checksum = ? WHERE version = 1`,
    ).run("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");

    const beforeLedger = ledgerRows(db);
    const beforeMaster = masterSnapshot(db);

    expect(() =>
      runSchemaMigrationsWithOptions(db, {
        migrations: [r1BaselineMigration],
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "SchemaMigrationError",
        code: "SCHEMA_LEDGER_MISMATCH",
      }),
    );

    expect(ledgerRows(db)).toEqual(beforeLedger);
    expect(masterSnapshot(db)).toEqual(beforeMaster);
  });

  it("rejects user_version mismatch without additional writes", () => {
    const db = openMemory();
    seedValidV1(db);
    db.pragma("user_version = 0");

    const beforeLedger = ledgerRows(db);
    const beforeMaster = masterSnapshot(db);

    expect(() =>
      runSchemaMigrationsWithOptions(db, {
        migrations: [r1BaselineMigration],
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "SchemaMigrationError",
        code: "SCHEMA_VERSION_MISMATCH",
      }),
    );

    expect(ledgerRows(db)).toEqual(beforeLedger);
    expect(masterSnapshot(db)).toEqual(beforeMaster);
    expect(db.pragma("user_version", {simple: true})).toBe(0);
  });

  it("rejects a future ledger version without additional writes", () => {
    const db = openMemory();
    seedValidV1(db);
    db.prepare(
      `INSERT INTO schema_migrations(version, name, checksum, applied_at)
       VALUES (?, ?, ?, ?)`,
    ).run(
      2,
      "future",
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      "2026-07-17T00:00:00.000Z",
    );
    db.pragma("user_version = 2");

    const beforeLedger = ledgerRows(db);
    const beforeMaster = masterSnapshot(db);

    expect(() =>
      runSchemaMigrationsWithOptions(db, {
        migrations: [r1BaselineMigration],
      }),
    ).toThrowError(
      expect.objectContaining({
        name: "SchemaMigrationError",
        code: "SCHEMA_FUTURE_VERSION",
      }),
    );

    expect(ledgerRows(db)).toEqual(beforeLedger);
    expect(masterSnapshot(db)).toEqual(beforeMaster);
  });

  it.each([
    "after_apply_before_ledger",
    "after_ledger_before_user_version",
  ] as const)(
    "rolls back completely when fault fires at %s, then retries cleanly",
    (faultPoint: MigrationFaultPoint) => {
      const db = openMemory();
      const marker = new Error(`fault:${faultPoint}`);

      expect(() =>
        runSchemaMigrationsWithOptions(db, {
          migrations: [r1BaselineMigration],
          now: () => "2026-07-17T00:00:00.000Z",
          fault: point => {
            if (point === faultPoint) throw marker;
          },
        }),
      ).toThrow(marker);

      expect(tableExists(db, "schema_migrations")).toBe(false);
      expect(tableExists(db, "projects")).toBe(false);
      expect(tableExists(db, "users")).toBe(false);
      expect(tableExists(db, "assets")).toBe(false);
      expect(db.pragma("user_version", {simple: true})).toBe(0);

      const onePass = openMemory();
      runSchemaMigrationsWithOptions(onePass, {
        migrations: [r1BaselineMigration],
        now: () => "2026-07-17T00:00:00.000Z",
      });

      runSchemaMigrationsWithOptions(db, {
        migrations: [r1BaselineMigration],
        now: () => "2026-07-17T00:00:00.000Z",
      });

      expect(ledgerRows(db)).toEqual(ledgerRows(onePass));
      expect(db.pragma("user_version", {simple: true})).toBe(1);
      expect(captureSchemaFingerprint(db)).toEqual(
        captureSchemaFingerprint(onePass),
      );
    },
  );

  it("maps foreign-key violations to SCHEMA_FOREIGN_KEY_VIOLATION and rolls back", () => {
    const db = openMemory();
    const bad = createMigration({
      version: 1,
      name: "fk-bad",
      apply(migrationDb) {
        migrationDb.exec(`
          CREATE TABLE parent (id INTEGER PRIMARY KEY);
          CREATE TABLE child (
            id INTEGER PRIMARY KEY,
            parent_id INTEGER,
            FOREIGN KEY (parent_id) REFERENCES parent(id)
              DEFERRABLE INITIALLY DEFERRED
          );
          INSERT INTO child (id, parent_id) VALUES (1, 999);
        `);
      },
    });

    expect(() =>
      runSchemaMigrationsWithOptions(db, {migrations: [bad]}),
    ).toThrowError(
      expect.objectContaining({
        name: "SchemaMigrationError",
        code: "SCHEMA_FOREIGN_KEY_VIOLATION",
      }),
    );

    expect(tableExists(db, "schema_migrations")).toBe(false);
    expect(tableExists(db, "parent")).toBe(false);
    expect(tableExists(db, "child")).toBe(false);
    expect(db.pragma("user_version", {simple: true})).toBe(0);
  });

  it("maps SQLITE_BUSY from BEGIN IMMEDIATE to SCHEMA_BUSY without writes", () => {
    const {db: owner, dbPath} = openFileDb();
    const contender = new Database(dbPath);
    dbs.push(contender);
    configureSqliteConnection(contender, {busyTimeoutMs: 25});

    owner.exec("BEGIN IMMEDIATE");
    try {
      expect(() =>
        runSchemaMigrationsWithOptions(contender, {
          migrations: [r1BaselineMigration],
        }),
      ).toThrowError(
        expect.objectContaining({
          name: "SchemaMigrationError",
          code: "SCHEMA_BUSY",
        }),
      );

      expect(tableExists(contender, "schema_migrations")).toBe(false);
      expect(tableExists(contender, "projects")).toBe(false);
      expect(contender.pragma("user_version", {simple: true})).toBe(0);
    } finally {
      owner.exec("ROLLBACK");
    }
  });

  it("rejects an invalid registry before touching the database", () => {
    const db = openMemory();
    const beforeMaster = masterSnapshot(db);

    expect(() =>
      runSchemaMigrationsWithOptions(db, {
        migrations: [
          createMigration({
            version: 2,
            name: "skips-one",
            apply() {},
          }),
        ],
      }),
    ).toThrow(/version 1/i);

    expect(masterSnapshot(db)).toEqual(beforeMaster);
    expect(db.pragma("user_version", {simple: true})).toBe(0);
  });

  it("rejects a registry checksum that does not match checksumSource", () => {
    const db = openMemory();
    const beforeMaster = masterSnapshot(db);
    const broken: SchemaMigration = {
      ...r1BaselineMigration,
      checksum: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    };

    expect(() =>
      runSchemaMigrationsWithOptions(db, {migrations: [broken]}),
    ).toThrow(/checksum/i);

    expect(masterSnapshot(db)).toEqual(beforeMaster);
  });
});

describe("SchemaMigrationError surface for runner codes", () => {
  it("exposes typed busy errors with cause", () => {
    const cause = new Error("SQLITE_BUSY");
    const error = new SchemaMigrationError(
      "SCHEMA_BUSY",
      "Timed out waiting for the schema migration lock",
      {cause},
    );
    expect(error.code).toBe("SCHEMA_BUSY");
    expect(error.cause).toBe(cause);
  });
});
