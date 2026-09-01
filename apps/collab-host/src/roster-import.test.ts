import {describe, expect, it} from "vitest";
import {
  ROSTER_SHEET_COLUMNS,
  rosterSheetTemplateHeaders,
} from "@blocksync/classroom-access";
import {
  buildImportPreviewRows,
  computePreviewHash,
  hasBlockingPreviewRows,
  parseRosterCsv,
  RosterCsvParseError,
  type ExistingRosterStudent,
} from "./roster-import.js";

function header(columns = ROSTER_SHEET_COLUMNS): string {
  return columns.join(",");
}

describe("roster-import preview (Hermes PR 3.1 criteria)", () => {
  const existing: ExistingRosterStudent[] = [
    {
      studentId: "stu-1",
      studentCode: "S001",
      displayName: "山田太郎",
      attendanceNumber: "01",
      loginName: "yamada01",
      googleEmail: "yamada01@school.example",
      groupLabel: "A",
      active: true,
    },
  ];

  it("1. unknown columns warn only — rows still add/update", () => {
    const csv = [
      `${header()},extra_col`,
      "S010,新規,10,new,,B,true,ignored",
    ].join("\n");
    const {rows, ignoredColumns} = buildImportPreviewRows({
      parsedRows: parseRosterCsv(csv),
      existingStudents: [],
    });
    expect(rows.some(row => row.category === "add")).toBe(true);
    expect(hasBlockingPreviewRows(rows)).toBe(false);
    expect(ignoredColumns).toEqual(["extra_col"]);
    expect(rows[0]?.issues.some(issue => issue.code === "UNKNOWN_COLUMN")).toBe(true);
  });

  it("2. CSV without active column treats all rows as add", () => {
    const csv = [
      "student_code,display_name,attendance_number,login_name,group_label",
      "S010,新規,10,new,B",
    ].join("\n");
    const {rows} = buildImportPreviewRows({
      parsedRows: parseRosterCsv(csv),
      existingStudents: [],
    });
    expect(rows.every(row => row.category === "add")).toBe(true);
    expect(hasBlockingPreviewRows(rows)).toBe(false);
  });

  it("3. relax_quotes:false rejects malformed quotes as rejected_row", () => {
    const csv = [
      header(),
      'S010,"unclosed name,10,new,B,true',
    ].join("\n");
    expect(() => parseRosterCsv(csv)).toThrow(RosterCsvParseError);
    try {
      parseRosterCsv(csv);
    } catch (error) {
      expect(error).toBeInstanceOf(RosterCsvParseError);
      const rejected = (error as RosterCsvParseError).rejectedRows;
      expect(rejected[0]?.category).toBe("rejected_row");
      expect(rejected[0]?.rowNumber).toBeGreaterThan(0);
      expect(rejected[0]?.issues[0]?.code).toBe("CSV_PARSE_ERROR");
    }
  });

  it("4. unchanged category on identical re-import", () => {
    const csv = [header(), "S001,山田太郎,01,yamada01,yamada01@school.example,A,true"].join("\n");
    const {rows} = buildImportPreviewRows({
      parsedRows: parseRosterCsv(csv),
      existingStudents: existing,
    });
    expect(rows.some(row => row.category === "unchanged")).toBe(true);
    expect(rows.some(row => row.category === "update")).toBe(false);
  });

  it("5. deactivateMissing defaults false and affects previewHash", () => {
    const csv = [header(), "S001,山田太郎,01,yamada01,yamada01@school.example,A,true"].join("\n");
    const parsed = parseRosterCsv(csv);
    const rosterMembers = [
      ...existing,
      {
        studentId: "stu-2",
        studentCode: "S002",
        displayName: "佐藤",
        attendanceNumber: "02",
        loginName: "sato",
        googleEmail: null,
        groupLabel: "A",
        active: true,
      },
    ];
    const off = buildImportPreviewRows({
      parsedRows: parsed,
      existingStudents: rosterMembers,
      rosterMembers,
      deactivateMissing: false,
    });
    const on = buildImportPreviewRows({
      parsedRows: parsed,
      existingStudents: rosterMembers,
      rosterMembers,
      deactivateMissing: true,
    });
    expect(off.rows.some(row => row.category === "deactivate")).toBe(false);
    expect(on.rows.some(row => row.category === "deactivate")).toBe(true);
    expect(off.missingFromCsvCount).toBe(1);

    const hashOff = computePreviewHash({
      baseRosterRevision: 0,
      deactivateMissing: false,
      rows: off.rows,
    });
    const hashOn = computePreviewHash({
      baseRosterRevision: 0,
      deactivateMissing: true,
      rows: on.rows,
    });
    expect(hashOff).not.toBe(hashOn);
  });

  it("detects duplicate student_code within import", () => {
    const csv = [
      header(),
      "S010,重複A,10,a,,A,true",
      "S010,重複B,11,b,,B,true",
    ].join("\n");
    const {rows} = buildImportPreviewRows({
      parsedRows: parseRosterCsv(csv),
      existingStudents: [],
    });
    expect(rows.filter(row => row.category === "duplicate_candidate")).toHaveLength(1);
    expect(hasBlockingPreviewRows(rows)).toBe(true);
  });

  it("preserves leading zeros in attendance_number", () => {
    const csv = [header(), "S010,出席,007,user,,B,true"].join("\n");
    const {rows} = buildImportPreviewRows({
      parsedRows: parseRosterCsv(csv),
      existingStudents: [],
    });
    const addRow = rows.find(row => row.category === "add");
    expect((addRow?.proposed as {attendanceNumber?: string}).attendanceNumber).toBe(
      "007",
    );
  });

  it("parses CSV with Japanese header labels", () => {
    const csv = [
      rosterSheetTemplateHeaders().join(","),
      "S001,山田太郎,01,yamada01,yamada01@school.example,A,1",
    ].join("\n");
    const parsed = parseRosterCsv(csv);
    expect(parsed[0]?.raw.student_code).toBe("S001");
    expect(parsed[0]?.raw.display_name).toBe("山田太郎");
    expect(parsed[0]?.raw.google_email).toBe("yamada01@school.example");
  });

  it("normalizes google_email and rejects invalid values", () => {
    const csv = [header(), "S010,新規,10,new,not-an-email,B,true"].join("\n");
    expect(() => parseRosterCsv(csv)).not.toThrow();
    const {rows} = buildImportPreviewRows({
      parsedRows: parseRosterCsv(csv),
      existingStudents: [],
    });
    expect(rows[0]?.category).toBe("rejected_row");
    expect(rows[0]?.issues.some(issue => issue.code === "INVALID_GOOGLE_EMAIL")).toBe(
      true,
    );
  });

  it("detects duplicate google_email within import", () => {
    const csv = [
      header(),
      "S010,重複A,10,a,alice@school.example,A,true",
      "S011,重複B,11,b,alice@school.example,B,true",
    ].join("\n");
    const {rows} = buildImportPreviewRows({
      parsedRows: parseRosterCsv(csv),
      existingStudents: [],
    });
    expect(rows.filter(row => row.category === "duplicate_candidate")).toHaveLength(1);
    expect(hasBlockingPreviewRows(rows)).toBe(true);
  });

  it("detects google_email collision with existing owner student", () => {
    const csv = [header(), "S010,新規,10,new,alice@school.example,B,true"].join("\n");
    const {rows} = buildImportPreviewRows({
      parsedRows: parseRosterCsv(csv),
      existingStudents: [
        {
          studentId: "stu-x",
          studentCode: "S999",
          displayName: "既存",
          attendanceNumber: null,
          loginName: "existing",
          googleEmail: "alice@school.example",
          groupLabel: null,
          active: true,
        },
      ],
    });
    expect(rows[0]?.category).toBe("duplicate_candidate");
    expect(hasBlockingPreviewRows(rows)).toBe(true);
  });

  it("warns on non-canonical student_code but still adds", () => {
    const csv = [header(), "S010,新規,10,new,,B,true"].join("\n");
    const {rows} = buildImportPreviewRows({
      parsedRows: parseRosterCsv(csv),
      existingStudents: [],
    });
    expect(rows[0]?.category).toBe("add");
    expect(hasBlockingPreviewRows(rows)).toBe(false);
    expect(rows[0]?.issues.some(issue => issue.code === "STUDENT_CODE_FORMAT")).toBe(
      true,
    );
  });

  it("accepts canonical 6-digit student_code without format warning", () => {
    const csv = [header(), "261101,山田,01,yamada,,A,true"].join("\n");
    const {rows} = buildImportPreviewRows({
      parsedRows: parseRosterCsv(csv),
      existingStudents: [],
    });
    expect(rows[0]?.category).toBe("add");
    expect(rows[0]?.issues.some(issue => issue.code === "STUDENT_CODE_FORMAT")).toBe(
      false,
    );
  });
});
