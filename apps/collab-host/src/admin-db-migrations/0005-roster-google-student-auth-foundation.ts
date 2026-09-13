/**
 * Admin DB migration v5 — roster Google student auth foundation (G1).
 *
 * Adds google_email / google_subject on students and student auth policy fields.
 */
import type Database from "better-sqlite3";
import {tableHasColumnAdmin} from "./schema-fingerprint.js";
import type {AdminSchemaMigration} from "./types.js";

export const ROSTER_GOOGLE_STUDENT_AUTH_STUDENT_ALTER_SQL = `
        ALTER TABLE classroom_students ADD COLUMN google_email TEXT;
        ALTER TABLE classroom_students ADD COLUMN google_subject TEXT;
      `;

export const ROSTER_GOOGLE_STUDENT_AUTH_POLICY_ALTER_SQL = `
        ALTER TABLE classroom_policies ADD COLUMN student_auth_method TEXT NOT NULL DEFAULT 'google-or-local';
        ALTER TABLE classroom_policies ADD COLUMN student_auth_allowed_domains_json TEXT NOT NULL DEFAULT '[]';
      `;

export const ROSTER_GOOGLE_STUDENT_AUTH_INDEX_SQL = `
      CREATE UNIQUE INDEX IF NOT EXISTS idx_classroom_students_owner_google_email
        ON classroom_students(owner_admin_id, google_email)
        WHERE google_email IS NOT NULL;

      CREATE UNIQUE INDEX IF NOT EXISTS idx_classroom_students_owner_google_subject
        ON classroom_students(owner_admin_id, google_subject)
        WHERE google_subject IS NOT NULL;
    `;

export function applyRosterGoogleStudentAuthSchema(db: Database.Database): void {
  if (!tableHasColumnAdmin(db, "classroom_students", "google_email")) {
    db.exec(ROSTER_GOOGLE_STUDENT_AUTH_STUDENT_ALTER_SQL);
  }
  if (!tableHasColumnAdmin(db, "classroom_policies", "student_auth_method")) {
    db.exec(ROSTER_GOOGLE_STUDENT_AUTH_POLICY_ALTER_SQL);
  }
  db.exec(ROSTER_GOOGLE_STUDENT_AUTH_INDEX_SQL);
}

export const rosterGoogleStudentAuthChecksumSource = [
  "version=5",
  "name=roster-google-student-auth-foundation",
  ROSTER_GOOGLE_STUDENT_AUTH_STUDENT_ALTER_SQL,
  ROSTER_GOOGLE_STUDENT_AUTH_POLICY_ALTER_SQL,
  ROSTER_GOOGLE_STUDENT_AUTH_INDEX_SQL,
].join("\n");

export const rosterGoogleStudentAuthMigration: AdminSchemaMigration = {
  version: 5,
  name: "roster-google-student-auth-foundation",
  checksumSource: rosterGoogleStudentAuthChecksumSource,
  checksum: "982f6ee701d76e60d50375a49fda3c22db3b16b1d8409e2b0ef10015b09bd4f8",
  apply(db: Database.Database): void {
    applyRosterGoogleStudentAuthSchema(db);
  },
};
