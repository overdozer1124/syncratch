import {randomBytes} from "node:crypto";
import {existsSync, renameSync} from "node:fs";
import Database from "better-sqlite3";
import targetFingerprint from "../r1-target-schema-fingerprint.json" with {
  type: "json",
};
import {
  captureSchemaFingerprint,
  fingerprintDifference,
} from "../schema-fingerprint.js";
import {
  SchemaMigrationError,
  type MigrationContext,
} from "../types.js";
import {captureLegacyDataDigest} from "./legacy-digest.js";
import {
  r1LegacyOrganizationUserBackfillChecksum,
  r1LegacyOrganizationUserBackfillName,
} from "./v5-descriptor.js";

export type LegacyBackfillPreparation =
  | {kind: "empty"}
  | {kind: "verified"; backupPath: string; legacyDigest: string}
  | {kind: "already_applied"; backupPath: string};

interface BackupPreparationSeams {
  readonly destinationPath?: (
    databasePath: string,
    context: MigrationContext,
  ) => string;
  readonly afterVacuum?: (backupPath: string) => void;
  readonly renameArtifact?: (from: string, to: string) => void;
}

const triggerTables = [
  "organizations",
  "users",
  "organization_memberships",
  "sessions",
  "projects",
  "project_members",
] as const;

function hasPendingLegacyData(db: Database.Database): boolean {
  const selections = triggerTables
    .map(table => `SELECT 1 AS present FROM "${table}"`)
    .join("\nUNION ALL\n");
  return db.prepare(`SELECT 1 FROM (${selections}) LIMIT 1`).get() !== undefined;
}

function compactTimestamp(timestamp: string): string {
  return timestamp.replace(/[-:.]/g, "");
}

function createDestinationPath(
  databasePath: string,
  context: MigrationContext,
): string {
  return `${databasePath}.pre-v5.${compactTimestamp(context.appliedAt)}.${randomBytes(8).toString("hex")}.sqlite`;
}

function quoteSqlStringLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function assertIntegrity(backup: Database.Database): void {
  const result = backup.pragma("integrity_check", {simple: true});
  if (result !== "ok") {
    throw new Error("Backup integrity_check did not return exactly ok");
  }
}

function assertNoForeignKeyViolations(backup: Database.Database): void {
  const violations = backup.prepare("PRAGMA foreign_key_check").all();
  if (violations.length !== 0) {
    throw new Error("Backup contains foreign-key violations");
  }
}

function liveLedgerHasExactV5(db: Database.Database): boolean {
  const liveVersion = db.pragma("user_version", {simple: true}) as number;
  if (liveVersion !== 5) return false;

  const ledgerExists =
    db
      .prepare(
        `SELECT 1
         FROM sqlite_schema
         WHERE type = 'table' AND name = 'schema_migrations'`,
      )
      .get() !== undefined;
  if (!ledgerExists) return false;

  const row = db
    .prepare(
      `SELECT name, checksum
       FROM schema_migrations
       WHERE version = 5`,
    )
    .get() as {name: string; checksum: string} | undefined;
  return (
    row?.name === r1LegacyOrganizationUserBackfillName &&
    row.checksum === r1LegacyOrganizationUserBackfillChecksum
  );
}

function supersededPath(backupPath: string): string {
  return backupPath.endsWith(".sqlite")
    ? `${backupPath.slice(0, -".sqlite".length)}.superseded-v5.sqlite`
    : `${backupPath}.superseded-v5.sqlite`;
}

function verifyBackup(
  source: Database.Database,
  backupPath: string,
  sourceDigest: string,
  renameArtifact: (from: string, to: string) => void,
): LegacyBackfillPreparation {
  const backup = new Database(backupPath, {
    readonly: true,
    fileMustExist: true,
  });
  let isSupersededV5 = false;
  let backupDigest: string | undefined;
  try {
    backup.pragma("foreign_keys = ON");
    assertIntegrity(backup);
    assertNoForeignKeyViolations(backup);

    const version = backup.pragma("user_version", {simple: true}) as number;
    if (version === 5) {
      if (!liveLedgerHasExactV5(source)) {
        throw new Error("Backup version 5 lacks the exact live v5 ledger");
      }
      isSupersededV5 = true;
    } else if (version !== 4) {
      throw new Error(`Backup user_version must be 4, received ${version}`);
    } else {
      const fingerprint = captureSchemaFingerprint(backup);
      const difference = fingerprintDifference(
        targetFingerprint.current,
        fingerprint,
      );
      if (difference !== null) {
        throw new Error(`Backup schema fingerprint mismatch: ${difference}`);
      }

      backupDigest = captureLegacyDataDigest(backup);
      if (backupDigest !== sourceDigest) {
        throw new Error("Backup legacy digest differs from the source digest");
      }
    }
  } finally {
    backup.close();
  }

  if (isSupersededV5) {
    const renamedPath = supersededPath(backupPath);
    if (existsSync(renamedPath)) {
      throw new Error("Superseded backup destination already exists");
    }
    renameArtifact(backupPath, renamedPath);
    return {kind: "already_applied", backupPath: renamedPath};
  }

  if (backupDigest === undefined) {
    throw new Error("Backup digest verification did not complete");
  }
  return {kind: "verified", backupPath, legacyDigest: backupDigest};
}

export function prepareLegacyBackfillBackup(
  db: Database.Database,
  context: MigrationContext,
  seams: BackupPreparationSeams = {},
): LegacyBackfillPreparation {
  try {
    if (!hasPendingLegacyData(db)) {
      return {kind: "empty"};
    }
    if (db.memory) {
      throw new Error("A legacy backfill backup requires a file database");
    }

    const sourceDigest = captureLegacyDataDigest(db);
    const destinationPath =
      seams.destinationPath?.(db.name, context) ??
      createDestinationPath(db.name, context);
    if (existsSync(destinationPath)) {
      throw new Error("Backup destination already exists");
    }

    db.exec(`VACUUM INTO ${quoteSqlStringLiteral(destinationPath)}`);
    seams.afterVacuum?.(destinationPath);

    return verifyBackup(
      db,
      destinationPath,
      sourceDigest,
      seams.renameArtifact ?? renameSync,
    );
  } catch (error) {
    if (
      error instanceof SchemaMigrationError &&
      error.code === "SCHEMA_BACKUP_FAILED"
    ) {
      throw error;
    }
    throw new SchemaMigrationError(
      "SCHEMA_BACKUP_FAILED",
      "Failed to create and verify the pre-v5 legacy backup",
      {cause: error},
    );
  }
}
