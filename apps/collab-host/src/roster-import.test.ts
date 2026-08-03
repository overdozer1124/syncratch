import {describe, expect, it} from "vitest";
import {ROSTER_SHEET_COLUMNS} from "@blocksync/classroom-access";
import {
  buildImportPreviewRows,
  computePreviewHash,
  hasBlockingPreviewRows,
  parseRosterCsv,
  type ExistingRosterStudent,
} from "./roster-import.js";

function header(): string {
  return ROSTER_SHEET_COLUMNS.join(",");
}

describe("roster-import preview", () => {
  const existing: ExistingRosterStudent[] = [
    {
      studentId: "stu-1",
      studentCode: "S001",
      displayName: "山田太郎",
      attendanceNumber: "01",
      loginName: "yamada01",
      groupLabel: "A",
      active: true,
    },
    {
      studentId: "stu-2",
      studentCode: "S002",
      displayName: "佐藤花子",
      attendanceNumber: "02",
      loginName: "sato02",
      groupLabel: "A",
      active: true,
    },
  ];

  it("classifies add, update, deactivate, and rejected rows", () => {
    const csv = [
      header(),
      "S001,山田太郎,01,yamada01,A,true",
      "S003,鈴木一郎,03,suzuki03,B,true",
      "S004,,04,,,true",
      "S001,S001改,01,yamada01,A,true",
      "S002,佐藤花子,02,sato02,A,false",
    ].join("\n");
    const drafts = buildImportPreviewRows({
      parsedRows: parseRosterCsv(csv),
      existingStudents: existing,
    });
    expect(drafts.some(row => row.category === "add" && row.proposed)).toBe(true);
    expect(drafts.some(row => row.category === "update")).toBe(true);
    expect(drafts.some(row => row.category === "deactivate")).toBe(true);
    expect(drafts.some(row => row.category === "rejected_row")).toBe(true);
  });

  it("detects duplicate student_code within import", () => {
    const csv = [
      header(),
      "S010,重複A,10,a,A,true",
      "S010,重複B,11,b,B,true",
    ].join("\n");
    const drafts = buildImportPreviewRows({
      parsedRows: parseRosterCsv(csv),
      existingStudents: [],
    });
    expect(drafts.filter(row => row.category === "duplicate_candidate")).toHaveLength(1);
    expect(hasBlockingPreviewRows(drafts)).toBe(true);
  });

  it("detects attendance_number collisions", () => {
    const csv = [
      header(),
      "S010,生徒A,07,a,A,true",
      "S011,生徒B,07,b,B,true",
    ].join("\n");
    const drafts = buildImportPreviewRows({
      parsedRows: parseRosterCsv(csv),
      existingStudents: [],
    });
    expect(drafts.some(row => row.category === "attendance_collision")).toBe(true);
    expect(hasBlockingPreviewRows(drafts)).toBe(true);
  });

  it("deactivates active students missing from CSV", () => {
    const csv = [header(), "S001,山田太郎,01,yamada01,A,true"].join("\n");
    const drafts = buildImportPreviewRows({
      parsedRows: parseRosterCsv(csv),
      existingStudents: existing,
    });
    const implicitDeactivate = drafts.find(
      row => row.category === "deactivate" && row.studentId === "stu-2",
    );
    expect(implicitDeactivate).toBeTruthy();
  });

  it("computes stable preview_hash including base revision", () => {
    const csv = [header(), "S010,新規,10,new,B,true"].join("\n");
    const drafts = buildImportPreviewRows({
      parsedRows: parseRosterCsv(csv),
      existingStudents: [],
    });
    const hashA = computePreviewHash({baseRosterRevision: 0, rows: drafts});
    const hashB = computePreviewHash({baseRosterRevision: 0, rows: drafts});
    const hashC = computePreviewHash({baseRosterRevision: 1, rows: drafts});
    expect(hashA).toBe(hashB);
    expect(hashA).not.toBe(hashC);
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
  });

  it("preserves leading zeros in attendance_number", () => {
    const csv = [header(), "S010,出席,007,user,B,true"].join("\n");
    const drafts = buildImportPreviewRows({
      parsedRows: parseRosterCsv(csv),
      existingStudents: [],
    });
    const addRow = drafts.find(row => row.category === "add");
    expect((addRow?.proposed as {attendanceNumber?: string}).attendanceNumber).toBe(
      "007",
    );
  });
});
