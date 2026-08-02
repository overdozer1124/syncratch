import {adminPhase2BaselineMigration} from "./0001-admin-phase2-baseline.js";
import {classroomRosterFoundationMigration} from "./0002-classroom-roster-foundation.js";

export const ADMIN_DB_MIGRATIONS = [
  adminPhase2BaselineMigration,
  classroomRosterFoundationMigration,
] as const;

export {
  runAdminDbMigrations,
  applyAdminPhase2BaselineSchema,
  type RunAdminDbMigrationsOptions,
} from "./runner.js";
export {
  AdminSchemaMigrationError,
  type AdminSchemaMigration,
} from "./types.js";
export {classifyAdminLedgerlessDatabase} from "./schema-fingerprint.js";
