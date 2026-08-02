import type Database from "better-sqlite3";
import {applyPhase2BaselineSchema} from "./runner.js";
import type {AdminSchemaMigration} from "./types.js";

export const adminPhase2BaselineChecksumSource = [
  "version=1",
  "name=admin-phase2-baseline",
  "create=admin_accounts,classroom_policies,student_links,student_grants",
  "alter=editor_allow_extensions",
].join("\n");

export const adminPhase2BaselineMigration: AdminSchemaMigration = {
  version: 1,
  name: "admin-phase2-baseline",
  checksumSource: adminPhase2BaselineChecksumSource,
  checksum: "eaf96dd6f686cc269e0b854803a9f042dd3a934dadbe16a177efec585ea6c160",
  apply(db: Database.Database): void {
    applyPhase2BaselineSchema(db);
  },
};
