import type Database from "better-sqlite3";

export type AdminSchemaMigrationErrorCode =
  | "SCHEMA_UNKNOWN_LEGACY"
  | "SCHEMA_LEDGER_GAP"
  | "SCHEMA_LEDGER_MISMATCH"
  | "SCHEMA_VERSION_MISMATCH"
  | "SCHEMA_FUTURE_VERSION"
  | "SCHEMA_FOREIGN_KEY_VIOLATION";

export class AdminSchemaMigrationError extends Error {
  readonly name = "AdminSchemaMigrationError";

  constructor(
    readonly code: AdminSchemaMigrationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface AdminMigrationContext {
  appliedAt: string;
}

export interface AdminSchemaMigration {
  readonly version: number;
  readonly name: string;
  readonly checksumSource: string;
  readonly checksum: string;
  apply(db: Database.Database, context?: AdminMigrationContext): void;
}
