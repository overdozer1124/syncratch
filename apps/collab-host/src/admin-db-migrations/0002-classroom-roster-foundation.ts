import type Database from "better-sqlite3";
import {tableHasColumnAdmin} from "./schema-fingerprint.js";
import type {AdminSchemaMigration} from "./types.js";

export const classroomRosterFoundationChecksumSource = [
  "version=2",
  "name=classroom-roster-foundation",
  "alter=classroom_policies:roster_id,student_auth_required,submission_enabled",
  "create=classroom_rosters,classroom_students,classroom_roster_memberships,student_accounts,roster_imports,roster_import_rows,classroom_audit_events",
].join("\n");

export const classroomRosterFoundationMigration: AdminSchemaMigration = {
  version: 2,
  name: "classroom-roster-foundation",
  checksumSource: classroomRosterFoundationChecksumSource,
  checksum: "6b83d6bde014290794dfea23959630e2ea410b47fefba27776d79187b076063e",
  apply(db: Database.Database): void {
    if (!tableHasColumnAdmin(db, "classroom_policies", "roster_id")) {
      db.exec(`
        ALTER TABLE classroom_policies ADD COLUMN roster_id TEXT;
        ALTER TABLE classroom_policies
          ADD COLUMN student_auth_required INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE classroom_policies
          ADD COLUMN submission_enabled INTEGER NOT NULL DEFAULT 0;
      `);
    }

    db.exec(`
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
    `);
  },
};
