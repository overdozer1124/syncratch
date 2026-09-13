import type Database from "better-sqlite3";
import {computeMigrationChecksum} from "./checksum.js";
import {classifyAdminLedgerlessDatabase} from "./schema-fingerprint.js";
import {
  AdminSchemaMigrationError,
  type AdminMigrationContext,
  type AdminSchemaMigration,
} from "./types.js";

interface LedgerRow {
  version: number;
  name: string;
  checksum: string;
  applied_at: string;
}

export interface RunAdminDbMigrationsOptions {
  now?: () => string;
  migrations?: readonly AdminSchemaMigration[];
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

function validateRegistry(migrations: readonly AdminSchemaMigration[]): void {
  if (migrations.length === 0) {
    throw new Error("Admin migration registry must be non-empty");
  }
  const names = new Set<string>();
  for (let index = 0; index < migrations.length; index++) {
    const migration = migrations[index]!;
    const expectedVersion = index + 1;
    if (migration.version !== expectedVersion) {
      throw new Error(
        `Admin migration registry must start at version 1; expected ${expectedVersion}, received ${migration.version}`,
      );
    }
    if (names.has(migration.name)) {
      throw new Error(`Duplicate admin migration name "${migration.name}"`);
    }
    names.add(migration.name);
    const expectedChecksum = computeMigrationChecksum(migration.checksumSource);
    if (migration.checksum !== expectedChecksum) {
      throw new Error(
        `Admin migration ${migration.version} checksum mismatch`,
      );
    }
  }
}

function validateLedgerHistory(
  db: Database.Database,
  migrations: readonly AdminSchemaMigration[],
): LedgerRow[] {
  const rows = readLedgerRows(db);
  const userVersion = readUserVersion(db);
  const registryByVersion = new Map(
    migrations.map(migration => [migration.version, migration]),
  );

  if (rows.length === 0) {
    if (userVersion !== 0) {
      throw new AdminSchemaMigrationError(
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
      throw new AdminSchemaMigrationError(
        "SCHEMA_LEDGER_GAP",
        `Ledger versions must be gapless from 1; expected ${expectedVersion}, received ${row.version}`,
      );
    }
    const migration = registryByVersion.get(row.version);
    if (migration === undefined) {
      throw new AdminSchemaMigrationError(
        "SCHEMA_FUTURE_VERSION",
        `Ledger contains version ${row.version} newer than this binary`,
      );
    }
    if (row.name !== migration.name || row.checksum !== migration.checksum) {
      throw new AdminSchemaMigrationError(
        "SCHEMA_LEDGER_MISMATCH",
        `Ledger row for version ${row.version} does not match registered migration`,
      );
    }
  }

  const maxVersion = rows[rows.length - 1]!.version;
  if (userVersion !== maxVersion) {
    throw new AdminSchemaMigrationError(
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
  migration: AdminSchemaMigration,
): void {
  const violations = db.prepare("PRAGMA foreign_key_check").all();
  if (violations.length > 0) {
    throw new AdminSchemaMigrationError(
      "SCHEMA_FOREIGN_KEY_VIOLATION",
      `Migration ${migration.version} produced foreign-key violations`,
    );
  }
}

function insertLedgerRow(
  db: Database.Database,
  migration: AdminSchemaMigration,
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

function runInMigrationTransaction(db: Database.Database, fn: () => void): void {
  db.transaction(fn)();
}

function recordLedgerOnly(
  db: Database.Database,
  migration: AdminSchemaMigration,
  appliedAt: string,
): void {
  assertNoForeignKeyViolations(db, migration);
  insertLedgerRow(db, migration, appliedAt);
  setUserVersion(db, migration.version);
}

function applyAndRecordMigration(
  db: Database.Database,
  migration: AdminSchemaMigration,
  context: AdminMigrationContext,
): void {
  runInMigrationTransaction(db, () => {
    migration.apply(db, context);
    recordLedgerOnly(db, migration, context.appliedAt);
  });
}

function adoptLedgerlessBaseline(
  db: Database.Database,
  migration: AdminSchemaMigration,
  context: AdminMigrationContext,
): boolean {
  const classification = classifyAdminLedgerlessDatabase(db);
  switch (classification.kind) {
    case "empty":
      return false;
    case "phase2_current":
      runInMigrationTransaction(db, () => {
        createLedgerTable(db);
        recordLedgerOnly(db, migration, context.appliedAt);
      });
      return true;
    case "unknown":
      throw new AdminSchemaMigrationError(
        "SCHEMA_UNKNOWN_LEGACY",
        `Legacy admin schema is not accepted: ${classification.difference}`,
      );
  }
}

function initializeOrAdoptBaseline(
  db: Database.Database,
  migration: AdminSchemaMigration,
  context: AdminMigrationContext,
): void {
  if (adoptLedgerlessBaseline(db, migration, context)) {
    return;
  }
  runInMigrationTransaction(db, () => {
    createLedgerTable(db);
    migration.apply(db, context);
    recordLedgerOnly(db, migration, context.appliedAt);
  });
}

function isMigrationPending(
  db: Database.Database,
  migrations: readonly AdminSchemaMigration[],
  migration: AdminSchemaMigration,
): boolean {
  const rows = validateLedgerHistory(db, migrations);
  if (rows.some(row => row.version === migration.version)) {
    return false;
  }
  const maxApplied = rows.length === 0 ? 0 : rows[rows.length - 1]!.version;
  if (migration.version !== maxApplied + 1) {
    throw new AdminSchemaMigrationError(
      "SCHEMA_LEDGER_GAP",
      `Cannot apply migration ${migration.version}; next required version is ${maxApplied + 1}`,
    );
  }
  return true;
}

export function runAdminDbMigrations(
  db: Database.Database,
  migrations: readonly AdminSchemaMigration[],
  options: RunAdminDbMigrationsOptions = {},
): void {
  validateRegistry(migrations);
  const now = options.now ?? (() => new Date().toISOString());
  const context: AdminMigrationContext = {appliedAt: now()};

  for (const migration of migrations) {
    if (migration.version === 1) {
      if (!ledgerTableExists(db)) {
        initializeOrAdoptBaseline(db, migration, context);
      }
      continue;
    }

    if (isMigrationPending(db, migrations, migration)) {
      applyAndRecordMigration(db, migration, context);
    }
  }

  validateLedgerHistory(db, migrations);
}

export {applyAdminPhase2BaselineSchema} from "./0001-admin-phase2-baseline.js";
