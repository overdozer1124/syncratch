/**
 * Admin DB migration v4 — classroom submission metadata + policy folder binding.
 */
import type Database from "better-sqlite3";
import {tableHasColumnAdmin} from "./schema-fingerprint.js";
import type {AdminSchemaMigration} from "./types.js";

export const CLASSROOM_SUBMISSIONS_POLICY_ALTER_SQL = `
        ALTER TABLE classroom_policies ADD COLUMN submission_drive_folder_id TEXT;
      `;

export const CLASSROOM_SUBMISSIONS_CREATE_SQL = `
      CREATE TABLE IF NOT EXISTS classroom_submissions (
        submission_id TEXT PRIMARY KEY,
        policy_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        student_account_id TEXT NOT NULL,
        drive_file_id TEXT,
        content_sha256 TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        project_title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('submitted', 'failed')),
        is_resubmission INTEGER NOT NULL DEFAULT 0,
        idempotency_key TEXT NOT NULL,
        submitted_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (policy_id) REFERENCES classroom_policies(policy_id),
        FOREIGN KEY (student_id) REFERENCES classroom_students(student_id),
        FOREIGN KEY (student_account_id) REFERENCES student_accounts(account_id),
        UNIQUE(student_account_id, idempotency_key)
      );

      CREATE INDEX IF NOT EXISTS idx_submissions_policy
        ON classroom_submissions(policy_id, submitted_at DESC);
      CREATE INDEX IF NOT EXISTS idx_submissions_student
        ON classroom_submissions(student_id, policy_id);
    `;

export function applyClassroomSubmissionsSchema(db: Database.Database): void {
  if (!tableHasColumnAdmin(db, "classroom_policies", "submission_drive_folder_id")) {
    db.exec(CLASSROOM_SUBMISSIONS_POLICY_ALTER_SQL);
  }
  db.exec(CLASSROOM_SUBMISSIONS_CREATE_SQL);
}

export const classroomSubmissionsChecksumSource = [
  "version=4",
  "name=classroom-submissions",
  CLASSROOM_SUBMISSIONS_POLICY_ALTER_SQL,
  CLASSROOM_SUBMISSIONS_CREATE_SQL,
].join("\n");

export const classroomSubmissionsMigration: AdminSchemaMigration = {
  version: 4,
  name: "classroom-submissions",
  checksumSource: classroomSubmissionsChecksumSource,
  checksum: "73591ae48e26e39b878061e407666e97c807c9be34c750596a9b74d389e8dc3a",
  apply(db: Database.Database): void {
    applyClassroomSubmissionsSchema(db);
  },
};
