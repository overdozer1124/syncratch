import {describe, expect, it} from "vitest";
import {ROSTER_SHEET_COLUMNS} from "@blocksync/classroom-access";
import {openAdminDb} from "./admin-db.js";
import {createRosterService, RosterServiceError} from "./roster-service.js";

function header(): string {
  return ROSTER_SHEET_COLUMNS.join(",");
}

describe("roster-service", () => {
  it("creates roster, imports CSV, applies preview with audit and revision bump", () => {
    const db = openAdminDb(":memory:");
    const admin = db.upsertAdminFromLogin({
      subject: "sub-1",
      email: "teacher@school.example",
      displayName: "Teacher",
    });
    const service = createRosterService(db.sqlite);
    const roster = service.createRoster(admin.adminId, {title: "3年A組"});
    expect(roster.rosterRevision).toBe(0);

    const csv = [
      header(),
      "S001,山田太郎,007,yamada01,A,true",
      "S002,佐藤花子,02,sato02,A,true",
    ].join("\n");
    const preview = service.createImportFromCsv(roster.rosterId, admin.adminId, csv);
    expect(preview.baseRosterRevision).toBe(0);
    expect(preview.rows.some(row => row.category === "add")).toBe(true);
    expect(preview.previewHash).toMatch(/^[0-9a-f]{64}$/);

    const result = service.applyImport({
      rosterId: roster.rosterId,
      importId: preview.import.importId,
      ownerAdminId: admin.adminId,
      previewHash: preview.previewHash,
      baseRosterRevision: preview.baseRosterRevision,
    });
    expect(result.roster.rosterRevision).toBe(1);
    expect(result.import.status).toBe("applied");

    const students = service.listStudents(roster.rosterId, admin.adminId);
    expect(students).toHaveLength(2);
    expect(students.find(s => s.studentCode === "S001")?.attendanceNumber).toBe(
      "007",
    );

    const auditCount = db.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM classroom_audit_events WHERE roster_id = ?`)
      .get(roster.rosterId) as {c: number};
    expect(auditCount.c).toBeGreaterThan(0);

    db.close();
  });

  it("rejects stale preview_hash on apply", () => {
    const db = openAdminDb(":memory:");
    const admin = db.upsertAdminFromLogin({
      subject: "sub-2",
      email: "teacher2@school.example",
      displayName: "Teacher",
    });
    const service = createRosterService(db.sqlite);
    const roster = service.createRoster(admin.adminId, {title: "名簿"});
    const csv = [header(), "S001,山田,01,y,A,true"].join("\n");
    const preview = service.createImportFromCsv(roster.rosterId, admin.adminId, csv);

    expect(() =>
      service.applyImport({
        rosterId: roster.rosterId,
        importId: preview.import.importId,
        ownerAdminId: admin.adminId,
        previewHash: "deadbeef".padEnd(64, "0"),
        baseRosterRevision: preview.baseRosterRevision,
      }),
    ).toThrow(RosterServiceError);

    const studentCount = service.listStudents(roster.rosterId, admin.adminId);
    expect(studentCount).toHaveLength(0);
    expect(service.getRoster(roster.rosterId, admin.adminId)?.rosterRevision).toBe(0);
    db.close();
  });

  it("rejects apply when preview has blocking rows", () => {
    const db = openAdminDb(":memory:");
    const admin = db.upsertAdminFromLogin({
      subject: "sub-3",
      email: "teacher3@school.example",
      displayName: "Teacher",
    });
    const service = createRosterService(db.sqlite);
    const roster = service.createRoster(admin.adminId, {title: "名簿"});
    const csv = [
      header(),
      "S001,重複,01,a,A,true",
      "S001,重複2,02,b,B,true",
    ].join("\n");
    const preview = service.createImportFromCsv(roster.rosterId, admin.adminId, csv);

    expect(() =>
      service.applyImport({
        rosterId: roster.rosterId,
        importId: preview.import.importId,
        ownerAdminId: admin.adminId,
        previewHash: preview.previewHash,
        baseRosterRevision: preview.baseRosterRevision,
      }),
    ).toThrow(RosterServiceError);

    db.close();
  });
});
