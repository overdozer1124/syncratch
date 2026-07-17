import type Database from "better-sqlite3";
import {addAssetGcGenerationIfMissing} from "../migrate-assets.js";
import {classifyLedgerlessDatabase} from "./schema-fingerprint.js";
import {computeMigrationChecksum} from "./checksum.js";
import {SchemaMigrationError, type SchemaMigration} from "./types.js";

export type MigrationFaultPoint =
  | "after_apply_before_ledger"
  | "after_ledger_before_user_version";

interface MigrationRunnerTestOptions {
  migrations: readonly SchemaMigration[];
  now?: () => string;
  fault?: (
    point: MigrationFaultPoint,
    migration: SchemaMigration,
  ) => void;
}

interface LedgerRow {
  version: number;
  name: string;
  checksum: string;
  applied_at: string;
}

function isSqliteBusyError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as {code?: unknown}).code;
  return code === "SQLITE_BUSY" || code === "SQLITE_BUSY_TIMEOUT";
}

function withMigrationTransaction<T>(
  db: Database.Database,
  fn: () => T,
): T {
  try {
    db.exec("BEGIN IMMEDIATE");
  } catch (error) {
    if (isSqliteBusyError(error)) {
      throw new SchemaMigrationError(
        "SCHEMA_BUSY",
        "Timed out waiting for the schema migration lock",
        {cause: error},
      );
    }
    throw error;
  }

  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Ignore rollback failure after primary error.
    }
    throw error;
  }
}

function validateRegistry(migrations: readonly SchemaMigration[]): void {
  if (migrations.length === 0) {
    throw new Error("Migration registry must be non-empty");
  }

  const names = new Set<string>();
  for (let index = 0; index < migrations.length; index++) {
    const migration = migrations[index]!;
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion) {
      throw new Error(
        `Migration registry must start at version 1 and increase by 1; expected version ${expectedVersion}, received ${migration.version}`,
      );
    }
    if (names.has(migration.name)) {
      throw new Error(
        `Migration registry names must be unique; duplicate name "${migration.name}"`,
      );
    }
    names.add(migration.name);
    const expectedChecksum = computeMigrationChecksum(migration.checksumSource);
    if (migration.checksum !== expectedChecksum) {
      throw new Error(
        `Migration ${migration.version} checksum does not match checksumSource`,
      );
    }
  }
}

function ledgerTableExists(db: Database.Database): boolean {
  const row = db
    .prepare(
      `SELECT 1 AS ok FROM sqlite_master
       WHERE type = 'table' AND name = 'schema_migrations'`,
    )
    .get() as {ok: number} | undefined;
  return row !== undefined;
}

function readLedgerRows(db: Database.Database): LedgerRow[] {
  if (!ledgerTableExists(db)) return [];
  return db
    .prepare(
      `SELECT version, name, checksum, applied_at
       FROM schema_migrations
       ORDER BY version`,
    )
    .all() as LedgerRow[];
}

function readUserVersion(db: Database.Database): number {
  return db.pragma("user_version", {simple: true}) as number;
}

function validateLedgerHistory(
  db: Database.Database,
  migrations: readonly SchemaMigration[],
): LedgerRow[] {
  const rows = readLedgerRows(db);
  const userVersion = readUserVersion(db);
  const registryByVersion = new Map(
    migrations.map(migration => [migration.version, migration]),
  );

  if (rows.length === 0) {
    if (userVersion !== 0) {
      throw new SchemaMigrationError(
        "SCHEMA_VERSION_MISMATCH",
        `Empty ledger requires user_version 0, received ${userVersion}`,
      );
    }
    return rows;
  }

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    const expectedVersion = index + 1;
    if (row.version !== expectedVersion) {
      throw new SchemaMigrationError(
        "SCHEMA_LEDGER_GAP",
        `Ledger versions must be gapless from 1; expected version ${expectedVersion}, received ${row.version}`,
      );
    }

    const migration = registryByVersion.get(row.version);
    if (migration === undefined) {
      throw new SchemaMigrationError(
        "SCHEMA_FUTURE_VERSION",
        `Ledger contains version ${row.version} newer than this binary`,
      );
    }

    if (row.name !== migration.name || row.checksum !== migration.checksum) {
      throw new SchemaMigrationError(
        "SCHEMA_LEDGER_MISMATCH",
        `Ledger row for version ${row.version} does not match the registered migration`,
      );
    }
  }

  const maxVersion = rows[rows.length - 1]!.version;
  if (userVersion !== maxVersion) {
    throw new SchemaMigrationError(
      "SCHEMA_VERSION_MISMATCH",
      `user_version ${userVersion} does not match ledger max version ${maxVersion}`,
    );
  }

  return rows;
}

function createLedgerTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY CHECK(version > 0),
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL
        CHECK(length(checksum) = 64
          AND checksum = lower(checksum)
          AND checksum NOT GLOB '*[^0-9a-f]*'),
      applied_at TEXT NOT NULL
    )
  `);
}

function assertNoForeignKeyViolations(
  db: Database.Database,
  migration: SchemaMigration,
): void {
  const violations = db.prepare("PRAGMA foreign_key_check").all();
  if (violations.length > 0) {
    throw new SchemaMigrationError(
      "SCHEMA_FOREIGN_KEY_VIOLATION",
      `Migration ${migration.version} produced foreign-key violations`,
    );
  }
}

function insertLedgerRow(
  db: Database.Database,
  migration: SchemaMigration,
  appliedAt: string,
): void {
  db.prepare(
    `INSERT INTO schema_migrations(version, name, checksum, applied_at)
     VALUES (?, ?, ?, ?)`,
  ).run(migration.version, migration.name, migration.checksum, appliedAt);
}

function setUserVersion(db: Database.Database, version: number): void {
  db.pragma(`user_version = ${version}`);
}

function recordAdoptedMigration(
  db: Database.Database,
  migration: SchemaMigration,
  appliedAt: string,
): void {
  assertNoForeignKeyViolations(db, migration);
  insertLedgerRow(db, migration, appliedAt);
  setUserVersion(db, migration.version);
}

function applyAndRecordMigration(
  db: Database.Database,
  migration: SchemaMigration,
  appliedAt: string,
  fault?: MigrationRunnerTestOptions["fault"],
): void {
  migration.apply(db);
  fault?.("after_apply_before_ledger", migration);
  assertNoForeignKeyViolations(db, migration);
  insertLedgerRow(db, migration, appliedAt);
  fault?.("after_ledger_before_user_version", migration);
  setUserVersion(db, migration.version);
}

function initializeOrAdoptBaseline(
  db: Database.Database,
  migration: SchemaMigration,
  appliedAt: string,
  fault?: MigrationRunnerTestOptions["fault"],
): void {
  const classification = classifyLedgerlessDatabase(db);
  switch (classification.kind) {
    case "empty":
      createLedgerTable(db);
      applyAndRecordMigration(db, migration, appliedAt, fault);
      return;
    case "current":
      createLedgerTable(db);
      recordAdoptedMigration(db, migration, appliedAt);
      return;
    case "pre_generation": {
      addAssetGcGenerationIfMissing(db);
      createLedgerTable(db);
      recordAdoptedMigration(db, migration, appliedAt);
      return;
    }
    case "unknown":
      throw new SchemaMigrationError(
        "SCHEMA_UNKNOWN_LEGACY",
        `Legacy schema is not accepted: ${classification.difference}`,
      );
  }
}

export function runSchemaMigrationsWithOptions(
  db: Database.Database,
  options: MigrationRunnerTestOptions,
): void {
  const migrations = options.migrations;
  const now = options.now ?? (() => new Date().toISOString());
  const fault = options.fault;

  validateRegistry(migrations);
  const appliedAt = now();

  for (const migration of migrations) {
    withMigrationTransaction(db, () => {
      const rows = validateLedgerHistory(db, migrations);
      if (rows.some(row => row.version === migration.version)) {
        return;
      }

      const maxApplied = rows.length === 0 ? 0 : rows[rows.length - 1]!.version;
      if (migration.version !== maxApplied + 1) {
        throw new SchemaMigrationError(
          "SCHEMA_LEDGER_GAP",
          `Cannot apply migration ${migration.version}; next required version is ${maxApplied + 1}`,
        );
      }

      if (!ledgerTableExists(db)) {
        initializeOrAdoptBaseline(db, migration, appliedAt, fault);
        return;
      }
      applyAndRecordMigration(db, migration, appliedAt, fault);
    });
  }
}
