import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import Database from "better-sqlite3";
import {describe, expect, it} from "vitest";
import {openAdminDb} from "../admin-db.js";
import {
  ADMIN_DB_MIGRATIONS,
  AdminSchemaMigrationError,
  classifyAdminLedgerlessDatabase,
  runAdminDbMigrations,
} from "./index.js";
import {computeMigrationChecksum} from "./checksum.js";
import {adminPhase2BaselineMigration} from "./0001-admin-phase2-baseline.js";
import {
  CLASSROOM_ROSTER_FOUNDATION_CREATE_SQL,
  classroomRosterFoundationChecksumSource,
  classroomRosterFoundationMigration,
} from "./0002-classroom-roster-foundation.js";
import {
  rosterGoogleStudentAuthMigration,
} from "./0005-roster-google-student-auth-foundation.js";
import {
  studentGoogleOAuthPendingMigration,
} from "./0006-student-google-oauth-pending.js";
import type {AdminSchemaMigration} from "./types.js";

function createPhase2LedgerlessDb(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE admin_accounts (
      admin_id TEXT PRIMARY KEY,
      subject TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      display_name TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE classroom_policies (
      policy_id TEXT PRIMARY KEY,
      owner_admin_id TEXT NOT NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      ai_enabled INTEGER NOT NULL,
      ai_level INTEGER NOT NULL,
      ai_allow_student_api_key INTEGER NOT NULL,
      editor_show_settings INTEGER NOT NULL,
      editor_allow_sb3_export INTEGER NOT NULL,
      editor_allow_sb3_import INTEGER NOT NULL,
      editor_allow_extensions INTEGER NOT NULL,
      collab_allow INTEGER NOT NULL,
      drive_allow INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE student_links (
      link_id TEXT PRIMARY KEY,
      policy_id TEXT NOT NULL,
      owner_admin_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      status TEXT NOT NULL,
      expires_at TEXT,
      created_at TEXT NOT NULL,
      revoked_at TEXT
    );
    CREATE TABLE student_grants (
      grant_id TEXT PRIMARY KEY,
      link_id TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO admin_accounts VALUES (
      'a1','sub','teacher@school.example',NULL,'active','t0','t0'
    );
    INSERT INTO classroom_policies VALUES (
      'p1','a1','legacy','active',0,2,0,0,1,1,1,1,0,'t0','t0'
    );
    INSERT INTO student_links VALUES (
      'l1','p1','a1','abcdefghijklmnopqrstuvwxyz12','memo','active',NULL,'t0',NULL
    );
  `);
  db.close();
}

function listRosterFoundationTables(db: Database.Database): string[] {
  return (
    db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name IN (
             'classroom_rosters',
             'classroom_students',
             'classroom_roster_memberships',
             'student_accounts',
             'roster_imports',
             'roster_import_rows',
             'classroom_audit_events'
           )
         ORDER BY name`,
      )
      .all() as Array<{name: string}>
  ).map(row => row.name);
}

describe("admin DB migrations", () => {
  it("classifies Phase 2 ledgerless databases", () => {
    const root = mkdtempSync(join(tmpdir(), "admin-db-phase2-"));
    const dbPath = join(root, "phase2.sqlite");
    createPhase2LedgerlessDb(dbPath);
    const db = new Database(dbPath);
    expect(classifyAdminLedgerlessDatabase(db)).toEqual({kind: "phase2_current"});
    db.close();
  });

  it("adopts Phase 2 ledgerless DB and applies roster foundation", () => {
    const root = mkdtempSync(join(tmpdir(), "admin-db-adopt-"));
    const dbPath = join(root, "phase2.sqlite");
    createPhase2LedgerlessDb(dbPath);

    const adminDb = openAdminDb(dbPath);
    const view = adminDb.resolveStudentPolicy("abcdefghijklmnopqrstuvwxyz12");
    expect(view?.editor.allowExtensions).toBe(true);
    expect(view?.studentAuth.required).toBe(false);
    expect(view?.studentAuth.method).toBe("google-or-local");
    expect(view?.submission.enabled).toBe(false);
    adminDb.close();

    const sqlite = new Database(dbPath);
    const ledger = sqlite
      .prepare(`SELECT version, name FROM schema_migrations ORDER BY version`)
      .all() as Array<{version: number; name: string}>;
    expect(ledger.map(row => row.version)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(sqlite.pragma("user_version", {simple: true})).toBe(6);
    const tables = sqlite
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name LIKE 'classroom_%'
         ORDER BY name`,
      )
      .all() as Array<{name: string}>;
    expect(tables.map(row => row.name)).toEqual([
      "classroom_audit_events",
      "classroom_policies",
      "classroom_roster_memberships",
      "classroom_rosters",
      "classroom_students",
      "classroom_submissions",
    ]);
    sqlite.close();
  });

  it("creates fresh DB at migration version 5", () => {
    const root = mkdtempSync(join(tmpdir(), "admin-db-fresh-"));
    const dbPath = join(root, "fresh.sqlite");
    const db = new Database(dbPath);
    db.pragma("foreign_keys = ON");
    runAdminDbMigrations(db, ADMIN_DB_MIGRATIONS);
    const ledger = db
      .prepare(`SELECT version FROM schema_migrations ORDER BY version`)
      .all() as Array<{version: number}>;
    expect(ledger.map(row => row.version)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(db.pragma("user_version", {simple: true})).toBe(6);
    const studentColumns = db
      .prepare(`PRAGMA table_info(classroom_students)`)
      .all() as Array<{name: string}>;
    expect(studentColumns.map(row => row.name)).toContain("google_email");
    expect(studentColumns.map(row => row.name)).toContain("google_subject");
    const policyColumns = db
      .prepare(`PRAGMA table_info(classroom_policies)`)
      .all() as Array<{name: string}>;
    expect(policyColumns.map(row => row.name)).toContain("student_auth_method");
    expect(policyColumns.map(row => row.name)).toContain(
      "student_auth_allowed_domains_json",
    );
    const tables = db
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name IN (
             'admin_google_oauth_pending',
             'admin_google_credentials',
             'classroom_submissions',
             'student_google_oauth_pending'
           )
         ORDER BY name`,
      )
      .all() as Array<{name: string}>;
    expect(tables.map(row => row.name)).toEqual([
      "admin_google_credentials",
      "admin_google_oauth_pending",
      "classroom_submissions",
      "student_google_oauth_pending",
    ]);
    db.close();
  });

  it("rolls back v2 DDL when apply throws before ledger write", () => {
    const root = mkdtempSync(join(tmpdir(), "admin-db-rollback-"));
    const dbPath = join(root, "rollback.sqlite");
    const db = new Database(dbPath);
    db.pragma("foreign_keys = ON");

    runAdminDbMigrations(db, [adminPhase2BaselineMigration]);
    expect(db.pragma("user_version", {simple: true})).toBe(1);

    const failingV2: AdminSchemaMigration = {
      ...classroomRosterFoundationMigration,
      apply(dbInstance) {
        dbInstance.exec(CLASSROOM_ROSTER_FOUNDATION_CREATE_SQL);
        throw new Error("simulated migration failure");
      },
    };

    expect(() =>
      runAdminDbMigrations(db, [adminPhase2BaselineMigration, failingV2]),
    ).toThrow(/simulated migration failure/);
    db.close();

    const reopened = new Database(dbPath);
    reopened.pragma("foreign_keys = ON");
    expect(listRosterFoundationTables(reopened)).toEqual([]);
    const ledger = reopened
      .prepare(`SELECT version FROM schema_migrations ORDER BY version`)
      .all() as Array<{version: number}>;
    expect(ledger.map(row => row.version)).toEqual([1]);
    expect(reopened.pragma("user_version", {simple: true})).toBe(1);
    reopened.close();
  });

  it("rejects ledgerless schemas that are not Phase 2 current", () => {
    const root = mkdtempSync(join(tmpdir(), "admin-db-unknown-"));
    const dbPath = join(root, "unknown.sqlite");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE admin_accounts (admin_id TEXT PRIMARY KEY);
      CREATE TABLE classroom_policies (policy_id TEXT PRIMARY KEY);
      CREATE TABLE student_links (link_id TEXT PRIMARY KEY);
    `);
    db.close();

    expect(() => openAdminDb(dbPath)).toThrow(AdminSchemaMigrationError);
  });

  it("detects tampered migration checksumSource before apply", () => {
    const tampered = {
      ...classroomRosterFoundationMigration,
      checksumSource: `${classroomRosterFoundationChecksumSource}\n-- injected`,
    };
    expect(
      computeMigrationChecksum(classroomRosterFoundationChecksumSource),
    ).toBe(classroomRosterFoundationMigration.checksum);
    expect(computeMigrationChecksum(tampered.checksumSource)).not.toBe(
      classroomRosterFoundationMigration.checksum,
    );

    const db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
    expect(() =>
      runAdminDbMigrations(db, [adminPhase2BaselineMigration, tampered]),
    ).toThrow(/checksum mismatch/);
    db.close();
  });

  it("registers v5 roster google student auth migration checksum", () => {
    expect(
      computeMigrationChecksum(rosterGoogleStudentAuthMigration.checksumSource),
    ).toBe(rosterGoogleStudentAuthMigration.checksum);
  });

  it("registers v6 student google oauth pending migration checksum", () => {
    expect(
      computeMigrationChecksum(studentGoogleOAuthPendingMigration.checksumSource),
    ).toBe(studentGoogleOAuthPendingMigration.checksum);
  });
});
