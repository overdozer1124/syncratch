/**
 * Admin DB migration v6 — student Google OAuth pending state (G3).
 */
import type Database from "better-sqlite3";
import type {AdminSchemaMigration} from "./types.js";

export const STUDENT_GOOGLE_OAUTH_PENDING_CREATE_SQL = `
      CREATE TABLE IF NOT EXISTS student_google_oauth_pending (
        state TEXT PRIMARY KEY,
        grant_id TEXT NOT NULL,
        code_verifier TEXT NOT NULL,
        return_to TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (grant_id) REFERENCES student_grants(grant_id)
      );

      CREATE INDEX IF NOT EXISTS idx_student_google_oauth_pending_expires
        ON student_google_oauth_pending(expires_at);
    `;

export function applyStudentGoogleOAuthPendingSchema(db: Database.Database): void {
  db.exec(STUDENT_GOOGLE_OAUTH_PENDING_CREATE_SQL);
}

export const studentGoogleOAuthPendingChecksumSource = [
  "version=6",
  "name=student-google-oauth-pending",
  STUDENT_GOOGLE_OAUTH_PENDING_CREATE_SQL,
].join("\n");

export const studentGoogleOAuthPendingMigration: AdminSchemaMigration = {
  version: 6,
  name: "student-google-oauth-pending",
  checksumSource: studentGoogleOAuthPendingChecksumSource,
  checksum: "2b04c8324e0c84d99e0b8902167a2b5fcfd45326e3f87bfb2ea8dd8d99ba3730",
  apply(db: Database.Database): void {
    applyStudentGoogleOAuthPendingSchema(db);
  },
};
