import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import Database from "better-sqlite3";
import {describe, expect, it} from "vitest";
import {openAdminDb} from "../admin-db.js";
import {
  ADMIN_DB_MIGRATIONS,
  classifyAdminLedgerlessDatabase,
  runAdminDbMigrations,
} from "../admin-db-migrations/index.js";

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
    expect(view?.submission.enabled).toBe(false);
    adminDb.close();

    const sqlite = new Database(dbPath);
    const ledger = sqlite
      .prepare(`SELECT version, name FROM schema_migrations ORDER BY version`)
      .all() as Array<{version: number; name: string}>;
    expect(ledger.map(row => row.version)).toEqual([1, 2]);
    expect(sqlite.pragma("user_version", {simple: true})).toBe(2);
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
    ]);
    sqlite.close();
  });

  it("creates fresh DB at migration version 2", () => {
    const root = mkdtempSync(join(tmpdir(), "admin-db-fresh-"));
    const dbPath = join(root, "fresh.sqlite");
    const db = new Database(dbPath);
    db.pragma("foreign_keys = ON");
    runAdminDbMigrations(db, ADMIN_DB_MIGRATIONS);
    const ledger = db
      .prepare(`SELECT version FROM schema_migrations ORDER BY version`)
      .all() as Array<{version: number}>;
    expect(ledger.map(row => row.version)).toEqual([1, 2]);
    expect(db.pragma("user_version", {simple: true})).toBe(2);
    db.close();
  });
});
