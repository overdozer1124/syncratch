import Database from "better-sqlite3";
import {afterEach, describe, expect, it} from "vitest";
import {r1IdentityCoreMigration} from "./0002-r1-identity-core.js";
import {
  r1SchoolRosterChecksumSource,
  r1SchoolRosterMigration,
} from "./0003-r1-school-roster.js";
import {computeMigrationChecksum} from "./checksum.js";
import {configureSqliteConnection} from "./configure.js";

const dbs: Database.Database[] = [];

function createMigratedDb(): Database.Database {
  const db = new Database(":memory:");
  dbs.push(db);
  configureSqliteConnection(db);
  r1IdentityCoreMigration.apply(db);
  r1SchoolRosterMigration.apply(db);
  return db;
}

function insertSchoolRosterBase(db: Database.Database): void {
  db.exec(`
    INSERT INTO workspaces(id, kind, name, created_at, updated_at)
    VALUES ('w1','school','School','2026-07-17T00:00:00.000Z','2026-07-17T00:00:00.000Z');
    INSERT INTO schools(id, workspace_id, name, created_at, updated_at)
    VALUES ('s1','w1','School','2026-07-17T00:00:00.000Z','2026-07-17T00:00:00.000Z');
    INSERT INTO academic_years(id, school_id, label, start_date, end_date, status)
    VALUES ('ay1','s1','2026','2026-04-01','2027-03-31','active');
    INSERT INTO grades(id, academic_year_id, code, display_label, sort_order)
    VALUES ('g1','ay1','1','Grade 1',1);
    INSERT INTO class_groups(id, academic_year_id, grade_id, label)
    VALUES ('c1','ay1','g1','Class A');
    INSERT INTO people(id, display_name, status, created_at, updated_at)
    VALUES ('p1','Ada','active','2026-07-17T00:00:00.000Z','2026-07-17T00:00:00.000Z');
    INSERT INTO people(id, display_name, status, created_at, updated_at)
    VALUES ('p2','Grace','active','2026-07-17T00:00:00.000Z','2026-07-17T00:00:00.000Z');
  `);
}

describe("0003 r1-school-roster", () => {
  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
  });

  it("has immutable version/name/checksum", () => {
    expect(r1SchoolRosterMigration.version).toBe(3);
    expect(r1SchoolRosterMigration.name).toBe("r1-school-roster");
    expect(r1SchoolRosterMigration.checksumSource).toBe(
      r1SchoolRosterChecksumSource,
    );
    expect(r1SchoolRosterMigration.checksum).toBe(
      computeMigrationChecksum(r1SchoolRosterChecksumSource),
    );
  });

  it("creates the school roster tables after identity core", () => {
    const db = createMigratedDb();

    for (const name of [
      "schools",
      "academic_years",
      "grades",
      "class_groups",
      "enrollments",
      "staff_assignments",
    ]) {
      expect(
        db
          .prepare(
            `SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`,
          )
          .get(name),
      ).toBeTruthy();
    }
  });

  it("rejects a class group whose grade belongs to another academic year", () => {
    const db = createMigratedDb();
    insertSchoolRosterBase(db);
    db.exec(`
      INSERT INTO academic_years(id, school_id, label, start_date, end_date, status)
      VALUES ('ay2','s1','2027','2027-04-01','2028-03-31','planned');
    `);

    expect(() =>
      db.exec(`
        INSERT INTO class_groups(id, academic_year_id, grade_id, label)
        VALUES ('c2','ay2','g1','Class B');
      `),
    ).toThrow(/FOREIGN KEY/);
  });

  it("rejects duplicate active attendance numbers in one class", () => {
    const db = createMigratedDb();
    insertSchoolRosterBase(db);
    db.exec(`
      INSERT INTO enrollments(
        id, person_id, class_group_id, status, start_date, end_date, attendance_number
      )
      VALUES ('e1','p1','c1','active','2026-04-01',NULL,'1');
    `);

    expect(() =>
      db.exec(`
        INSERT INTO enrollments(
          id, person_id, class_group_id, status, start_date, end_date, attendance_number
        )
        VALUES ('e2','p2','c1','active','2026-04-01',NULL,'1');
      `),
    ).toThrow(/UNIQUE/);
  });

  it("rejects duplicate active enrollment for one person and class", () => {
    const db = createMigratedDb();
    insertSchoolRosterBase(db);
    db.exec(`
      INSERT INTO enrollments(
        id, person_id, class_group_id, status, start_date, end_date, attendance_number
      )
      VALUES ('e1','p1','c1','active','2026-04-01',NULL,'1');
    `);

    expect(() =>
      db.exec(`
        INSERT INTO enrollments(
          id, person_id, class_group_id, status, start_date, end_date, attendance_number
        )
        VALUES ('e2','p1','c1','active','2026-04-02',NULL,'2');
      `),
    ).toThrow(/UNIQUE/);
  });

  it("rejects an enrollment whose start date is after its end date", () => {
    const db = createMigratedDb();
    insertSchoolRosterBase(db);

    expect(() =>
      db.exec(`
        INSERT INTO enrollments(
          id, person_id, class_group_id, status, start_date, end_date, attendance_number
        )
        VALUES ('e1','p1','c1','ended','2026-05-01','2026-04-30','1');
      `),
    ).toThrow(/CHECK/);
  });

  it("has no foreign key violations after applying v2 then v3", () => {
    const db = createMigratedDb();

    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
