/**
 * Admin DB migration v2.
 *
 * The `checksum` constant may only be updated when registering a NEW migration
 * version. Do NOT change the SQL below after v2 has shipped in production;
 * add a new migration instead.
 */
import type Database from "better-sqlite3";
import {tableHasColumnAdmin} from "./schema-fingerprint.js";
import type {AdminSchemaMigration} from "./types.js";

export const CLASSROOM_ROSTER_POLICY_ALTER_SQL = `
        ALTER TABLE classroom_policies ADD COLUMN roster_id TEXT;
        ALTER TABLE classroom_policies
          ADD COLUMN student_auth_required INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE classroom_policies
          ADD COLUMN submission_enabled INTEGER NOT NULL DEFAULT 0;
      `;

export const CLASSROOM_ROSTER_FOUNDATION_CREATE_SQL = `
      CREATE TABLE IF NOT EXISTS classroom_rosters (
        roster_id TEXT PRIMARY KEY,
        owner_admin_id TEXT NOT NULL,
        title TEXT NOT NULL,
        sheet_spreadsheet_id TEXT,
        sheet_tab_name TEXT,
        sheet_range TEXT,
        sync_status TEXT NOT NULL CHECK (sync_status IN ('active', 'sync_required')),
        roster_revision INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (owner_admin_id) REFERENCES admin_accounts(admin_id)
      );

      CREATE TABLE IF NOT EXISTS classroom_students (
        student_id TEXT PRIMARY KEY,
        owner_admin_id TEXT NOT NULL,
        student_code TEXT NOT NULL,
        display_name TEXT NOT NULL,
        attendance_number TEXT,
        login_name TEXT,
        group_label TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (owner_admin_id) REFERENCES admin_accounts(admin_id),
        UNIQUE(owner_admin_id, student_code)
      );

      CREATE TABLE IF NOT EXISTS classroom_roster_memberships (
        membership_id TEXT PRIMARY KEY,
        roster_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (roster_id) REFERENCES classroom_rosters(roster_id),
        FOREIGN KEY (student_id) REFERENCES classroom_students(student_id),
        UNIQUE(roster_id, student_id)
      );

      CREATE TABLE IF NOT EXISTS student_accounts (
        account_id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN (
          'pending_activation', 'active', 'disabled'
        )),
        password_hash TEXT,
        enrollment_code_hash TEXT,
        enrollment_code_expires_at TEXT,
        password_version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (student_id) REFERENCES classroom_students(student_id)
      );

      CREATE TABLE IF NOT EXISTS roster_imports (
        import_id TEXT PRIMARY KEY,
        roster_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN (
          'uploaded', 'validated', 'preview_ready', 'applied', 'failed', 'discarded'
        )),
        uploaded_at TEXT NOT NULL,
        preview_hash TEXT,
        base_roster_revision INTEGER,
        applied_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (roster_id) REFERENCES classroom_rosters(roster_id)
      );

      CREATE TABLE IF NOT EXISTS roster_import_rows (
        row_id TEXT PRIMARY KEY,
        import_id TEXT NOT NULL,
        row_number INTEGER NOT NULL,
        category TEXT NOT NULL,
        student_id TEXT,
        proposed_json TEXT NOT NULL,
        issues_json TEXT NOT NULL,
        FOREIGN KEY (import_id) REFERENCES roster_imports(import_id)
      );

      CREATE TABLE IF NOT EXISTS classroom_audit_events (
        event_id TEXT PRIMARY KEY,
        owner_admin_id TEXT NOT NULL,
        roster_id TEXT,
        student_id TEXT,
        event_type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (owner_admin_id) REFERENCES admin_accounts(admin_id)
      );

      CREATE INDEX IF NOT EXISTS idx_rosters_owner
        ON classroom_rosters(owner_admin_id);
      CREATE INDEX IF NOT EXISTS idx_students_owner
        ON classroom_students(owner_admin_id);
      CREATE INDEX IF NOT EXISTS idx_memberships_roster
        ON classroom_roster_memberships(roster_id);
      CREATE INDEX IF NOT EXISTS idx_imports_roster
        ON roster_imports(roster_id);
      CREATE INDEX IF NOT EXISTS idx_audit_owner
        ON classroom_audit_events(owner_admin_id);
    `;

export function applyClassroomRosterFoundationSchema(db: Database.Database): void {
  if (!tableHasColumnAdmin(db, "classroom_policies", "roster_id")) {
    db.exec(CLASSROOM_ROSTER_POLICY_ALTER_SQL);
  }
  db.exec(CLASSROOM_ROSTER_FOUNDATION_CREATE_SQL);
}

export const classroomRosterFoundationChecksumSource = [
  "version=2",
  "name=classroom-roster-foundation",
  CLASSROOM_ROSTER_POLICY_ALTER_SQL,
  CLASSROOM_ROSTER_FOUNDATION_CREATE_SQL,
].join("\n");

export const classroomRosterFoundationMigration: AdminSchemaMigration = {
  version: 2,
  name: "classroom-roster-foundation",
  checksumSource: classroomRosterFoundationChecksumSource,
  checksum: "f549e084eba59a21f48a34780e98a35d57894794a6dbdfc9b5535aad37ec6b87",
  apply(db: Database.Database): void {
    applyClassroomRosterFoundationSchema(db);
  },
};
