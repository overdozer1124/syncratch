import type Database from "better-sqlite3";

export type SchemaMigrationErrorCode =
  | "SCHEMA_UNKNOWN_LEGACY"
  | "SCHEMA_LEDGER_GAP"
  | "SCHEMA_LEDGER_MISMATCH"
  | "SCHEMA_VERSION_MISMATCH"
  | "SCHEMA_FUTURE_VERSION"
  | "SCHEMA_FOREIGN_KEY_VIOLATION"
  | "SCHEMA_BACKUP_FAILED"
  | "SCHEMA_BACKFILL_INVALID"
  | "SCHEMA_BUSY";

export class SchemaMigrationError extends Error {
  readonly name = "SchemaMigrationError";

  constructor(
    readonly code: SchemaMigrationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface MigrationContext {
  appliedAt: string;
}

export interface SchemaMigration {
  readonly version: number;
  readonly name: string;
  readonly checksumSource: string;
  readonly checksum: string;
  prepare?(db: Database.Database, context: MigrationContext): unknown;
  apply(
    db: Database.Database,
    context?: MigrationContext,
    preparation?: unknown,
  ): void;
}

export interface ConfigureSqliteOptions {
  busyTimeoutMs?: number;
}
