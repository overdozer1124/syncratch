import type Database from "better-sqlite3";
import {r1BaselineMigration} from "./0001-r1-baseline.js";
import {runSchemaMigrationsWithOptions} from "./runner.js";

const migrations = [r1BaselineMigration] as const;

export function runSchemaMigrations(db: Database.Database): void {
  runSchemaMigrationsWithOptions(db, {migrations});
}
