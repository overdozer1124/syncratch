import type Database from "better-sqlite3";
import {r1BaselineMigration} from "./0001-r1-baseline.js";
import {r1IdentityCoreMigration} from "./0002-r1-identity-core.js";
import {r1SchoolRosterMigration} from "./0003-r1-school-roster.js";
import {r1AccessImportAuditMigration} from "./0004-r1-access-import-audit.js";
import {runSchemaMigrationsWithOptions} from "./runner.js";

const migrations = [
  r1BaselineMigration,
  r1IdentityCoreMigration,
  r1SchoolRosterMigration,
  r1AccessImportAuditMigration,
] as const;

export function runSchemaMigrations(db: Database.Database): void {
  runSchemaMigrationsWithOptions(db, {migrations});
}
