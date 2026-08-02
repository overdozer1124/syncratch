import type Database from "better-sqlite3";
import {computeMigrationChecksum} from "./checksum.js";
import {
  classifyAdminLedgerlessDatabase,
  tableHasColumnAdmin,
} from "./schema-fingerprint.js";
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

function recordAdoptedMigration(
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
  migration.apply(db, context);
  assertNoForeignKeyViolations(db, migration);
  insertLedgerRow(db, migration, context.appliedAt);
  setUserVersion(db, migration.version);
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
      createLedgerTable(db);
      recordAdoptedMigration(db, migration, context.appliedAt);
      return true;
    case "phase1_legacy":
      createLedgerTable(db);
      migration.apply(db, context);
      recordAdoptedMigration(db, migration, context.appliedAt);
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
  createLedgerTable(db);
  applyAndRecordMigration(db, migration, context);
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
  now: () => string = () => new Date().toISOString(),
): void {
  validateRegistry(migrations);
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

export function applyPhase2BaselineSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_accounts (
      admin_id TEXT PRIMARY KEY,
      subject TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      display_name TEXT,
      status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS classroom_policies (
      policy_id TEXT PRIMARY KEY,
      owner_admin_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
      ai_enabled INTEGER NOT NULL,
      ai_level INTEGER NOT NULL,
      ai_allow_student_api_key INTEGER NOT NULL,
      editor_show_settings INTEGER NOT NULL,
      editor_allow_sb3_export INTEGER NOT NULL,
      editor_allow_sb3_import INTEGER NOT NULL,
      editor_allow_extensions INTEGER NOT NULL,
      collab_allow INTEGER NOT NULL,
      drive_allow INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (owner_admin_id) REFERENCES admin_accounts(admin_id)
    );

    CREATE TABLE IF NOT EXISTS student_links (
      link_id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL,
      owner_admin_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
      expires_at TEXT,
      created_at TEXT NOT NULL,
      revoked_at TEXT,
      FOREIGN KEY (policy_id) REFERENCES classroom_policies(policy_id),
      FOREIGN KEY (owner_admin_id) REFERENCES admin_accounts(admin_id)
    );

    CREATE INDEX IF NOT EXISTS idx_policies_owner
      ON classroom_policies(owner_admin_id);
    CREATE INDEX IF NOT EXISTS idx_links_owner_policy
      ON student_links(owner_admin_id, policy_id);
    CREATE INDEX IF NOT EXISTS idx_links_token
      ON student_links(token);
  `);

  if (!tableHasColumnAdmin(db, "classroom_policies", "editor_allow_extensions")) {
    db.exec(`
      ALTER TABLE classroom_policies
      ADD COLUMN editor_allow_extensions INTEGER NOT NULL DEFAULT 1
    `);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS student_grants (
      grant_id TEXT PRIMARY KEY,
      link_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (link_id) REFERENCES student_links(link_id)
    );

    CREATE INDEX IF NOT EXISTS idx_grants_link
      ON student_grants(link_id);
  `);
}

export {tableHasColumnAdmin};
