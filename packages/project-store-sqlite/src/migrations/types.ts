import type Database from "better-sqlite3";

export type SchemaMigrationErrorCode =
  | "SCHEMA_UNKNOWN_LEGACY"
  | "SCHEMA_LEDGER_GAP"
  | "SCHEMA_LEDGER_MISMATCH"
  | "SCHEMA_VERSION_MISMATCH"
  | "SCHEMA_FUTURE_VERSION"
  | "SCHEMA_FOREIGN_KEY_VIOLATION"
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

export interface SchemaMigration {
  readonly version: number;
  readonly name: string;
  readonly checksumSource: string;
  readonly checksum: string;
  apply(db: Database.Database): void;
}

export interface ConfigureSqliteOptions {
  busyTimeoutMs?: number;
}
