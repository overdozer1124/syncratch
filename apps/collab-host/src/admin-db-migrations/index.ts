import {adminPhase2BaselineMigration} from "./0001-admin-phase2-baseline.js";
import {classroomRosterFoundationMigration} from "./0002-classroom-roster-foundation.js";
import {adminGoogleCredentialMigration} from "./0003-admin-google-credential.js";
import {classroomSubmissionsMigration} from "./0004-classroom-submissions.js";

export const ADMIN_DB_MIGRATIONS = [
  adminPhase2BaselineMigration,
  classroomRosterFoundationMigration,
  adminGoogleCredentialMigration,
  classroomSubmissionsMigration,
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
