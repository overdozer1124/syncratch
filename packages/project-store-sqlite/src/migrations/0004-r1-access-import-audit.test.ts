import Database from "better-sqlite3";
import {afterEach, describe, expect, it} from "vitest";
import {r1BaselineMigration} from "./0001-r1-baseline.js";
import {r1IdentityCoreMigration} from "./0002-r1-identity-core.js";
import {r1SchoolRosterMigration} from "./0003-r1-school-roster.js";
import {
  r1AccessImportAuditChecksumSource,
  r1AccessImportAuditMigration,
} from "./0004-r1-access-import-audit.js";
import {computeMigrationChecksum} from "./checksum.js";
import {configureSqliteConnection} from "./configure.js";

const dbs: Database.Database[] = [];

function createMigratedDb(): Database.Database {
  const db = new Database(":memory:");
  dbs.push(db);
  configureSqliteConnection(db);
  r1BaselineMigration.apply(db);
  r1IdentityCoreMigration.apply(db);
  r1SchoolRosterMigration.apply(db);
  r1AccessImportAuditMigration.apply(db);
  return db;
}

function insertAccessBase(db: Database.Database): void {
  db.exec(`
    INSERT INTO workspaces(id, kind, name, created_at, updated_at)
    VALUES ('w1','school','School','2026-07-17T00:00:00.000Z','2026-07-17T00:00:00.000Z');
    INSERT INTO workspaces(id, kind, name, created_at, updated_at)
    VALUES ('w2','school','Other','2026-07-17T00:00:00.000Z','2026-07-17T00:00:00.000Z');
    INSERT INTO user_accounts(id, status, created_at, updated_at)
    VALUES ('a1','active','2026-07-17T00:00:00.000Z','2026-07-17T00:00:00.000Z');
    INSERT INTO people(id, display_name, status, created_at, updated_at)
    VALUES ('p1','Ada','active','2026-07-17T00:00:00.000Z','2026-07-17T00:00:00.000Z');
    INSERT INTO schools(id, workspace_id, name, created_at, updated_at)
    VALUES ('s1','w1','School','2026-07-17T00:00:00.000Z','2026-07-17T00:00:00.000Z');
    INSERT INTO schools(id, workspace_id, name, created_at, updated_at)
    VALUES ('s2','w2','Other School','2026-07-17T00:00:00.000Z','2026-07-17T00:00:00.000Z');
    INSERT INTO academic_years(id, school_id, label, start_date, end_date, status)
    VALUES ('ay1','s1','2026','2026-04-01','2027-03-31','active');
    INSERT INTO grades(id, academic_year_id, code, display_label, sort_order)
    VALUES ('g1','ay1','1','Grade 1',1);
    INSERT INTO class_groups(id, academic_year_id, grade_id, label)
    VALUES ('c1','ay1','g1','Class A');
  `);
}

describe("0004 r1-access-import-audit", () => {
  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
  });

  it("has immutable version/name/checksum", () => {
    expect(r1AccessImportAuditMigration.version).toBe(4);
    expect(r1AccessImportAuditMigration.name).toBe("r1-access-import-audit");
    expect(r1AccessImportAuditMigration.checksumSource).toBe(
      r1AccessImportAuditChecksumSource,
    );
    expect(r1AccessImportAuditMigration.checksum).toBe(
      computeMigrationChecksum(r1AccessImportAuditChecksumSource),
    );
  });

  it("rejects system scope with workspace_id and workspace teacher role", () => {
    const db = createMigratedDb();
    insertAccessBase(db);

    expect(() =>
      db.exec(`
        INSERT INTO role_assignments(
          id, account_id, scope_kind, workspace_id, school_id, class_group_id,
          project_id, role, status, started_at, ended_at
        )
        VALUES (
          'ra1','a1','system','w1',NULL,NULL,NULL,'owner','active',
          '2026-07-17T00:00:00.000Z',NULL
        );
      `),
    ).toThrow(/CHECK/);

    expect(() =>
      db.exec(`
        INSERT INTO role_assignments(
          id, account_id, scope_kind, workspace_id, school_id, class_group_id,
          project_id, role, status, started_at, ended_at
        )
        VALUES (
          'ra2','a1','workspace','w1',NULL,NULL,NULL,'teacher','active',
          '2026-07-17T00:00:00.000Z',NULL
        );
      `),
    ).toThrow(/CHECK/);
  });

  it("rejects duplicate active role assignments for the same account scope role", () => {
    const db = createMigratedDb();
    insertAccessBase(db);
    db.exec(`
      INSERT INTO role_assignments(
        id, account_id, scope_kind, workspace_id, school_id, class_group_id,
        project_id, role, status, started_at, ended_at
      )
      VALUES (
        'ra1','a1','workspace','w1',NULL,NULL,NULL,'admin','active',
        '2026-07-17T00:00:00.000Z',NULL
      );
    `);

    expect(() =>
      db.exec(`
        INSERT INTO role_assignments(
          id, account_id, scope_kind, workspace_id, school_id, class_group_id,
          project_id, role, status, started_at, ended_at
        )
        VALUES (
          'ra2','a1','workspace','w1',NULL,NULL,NULL,'admin','active',
          '2026-07-17T00:00:00.000Z',NULL
        );
      `),
    ).toThrow(/UNIQUE/);
  });

  it("rejects roster import whose school belongs to another workspace", () => {
    const db = createMigratedDb();
    insertAccessBase(db);

    expect(() =>
      db.exec(`
        INSERT INTO roster_imports(
          id, workspace_id, school_id, status, uploaded_at, preview_hash,
          base_directory_revision, applied_at
        )
        VALUES (
          'ri1','w1','s2','uploaded','2026-07-17T00:00:00.000Z',NULL,NULL,NULL
        );
      `),
    ).toThrow(/FOREIGN KEY/);
  });

  it("rejects invalid preview_hash and non-object/non-array json fields", () => {
    const db = createMigratedDb();
    insertAccessBase(db);
    db.exec(`
      INSERT INTO roster_imports(
        id, workspace_id, school_id, status, uploaded_at, preview_hash,
        base_directory_revision, applied_at
      )
      VALUES (
        'ri1','w1','s1','uploaded','2026-07-17T00:00:00.000Z',NULL,NULL,NULL
      );
    `);

    expect(() =>
      db.exec(`
        INSERT INTO roster_imports(
          id, workspace_id, school_id, status, uploaded_at, preview_hash,
          base_directory_revision, applied_at
        )
        VALUES (
          'ri2','w1','s1','uploaded','2026-07-17T00:00:00.000Z',
          'not-a-valid-sha256-hex','0',NULL
        );
      `),
    ).toThrow(/CHECK/);

    expect(() =>
      db.exec(`
        INSERT INTO roster_import_rows(
          id, import_id, row_number, category, person_id, proposed_json, issues_json
        )
        VALUES (
          'rir1','ri1',0,'add_person',NULL,'[]','[]'
        );
      `),
    ).toThrow(/CHECK/);

    expect(() =>
      db.exec(`
        INSERT INTO roster_import_rows(
          id, import_id, row_number, category, person_id, proposed_json, issues_json
        )
        VALUES (
          'rir2','ri1',1,'add_person',NULL,'{}','{}'
        );
      `),
    ).toThrow(/CHECK/);
  });

  it("aborts audit_events UPDATE and DELETE as append-only", () => {
    const db = createMigratedDb();
    insertAccessBase(db);
    db.exec(`
      INSERT INTO audit_events(
        id, workspace_id, actor_account_id, action, subject_type, subject_id,
        payload_json, created_at, directory_revision
      )
      VALUES (
        'ae1','w1','a1','role.assign','role_assignment','ra1',
        '{}','2026-07-17T00:00:00.000Z',0
      );
    `);

    expect(() =>
      db.exec(`UPDATE audit_events SET action = 'role.revoke' WHERE id = 'ae1';`),
    ).toThrow(/audit_events are append-only/);

    expect(() =>
      db.exec(`DELETE FROM audit_events WHERE id = 'ae1';`),
    ).toThrow(/audit_events are append-only/);
  });

  it("rejects project-scoped assignment when project_id is unknown", () => {
    const db = createMigratedDb();
    insertAccessBase(db);

    expect(() =>
      db.exec(`
        INSERT INTO role_assignments(
          id, account_id, scope_kind, workspace_id, school_id, class_group_id,
          project_id, role, status, started_at, ended_at
        )
        VALUES (
          'ra1','a1','project',NULL,NULL,NULL,'missing-project','viewer','active',
          '2026-07-17T00:00:00.000Z',NULL
        );
      `),
    ).toThrow(/FOREIGN KEY/);
  });

  it("has no foreign key violations on empty tables after apply", () => {
    const db = createMigratedDb();

    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
