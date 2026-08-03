/**
 * CSV roster import — parse, validate, preview categorization, preview_hash.
 */
import {createHash} from "node:crypto";
import {parse} from "csv-parse/sync";
import {
  ROSTER_SHEET_COLUMNS,
  type RosterImportPreviewCategory,
  type RosterImportPreviewRow,
  type RosterImportRowIssue,
} from "@blocksync/classroom-access";

export const MAX_ROSTER_CSV_BYTES = 2 * 1024 * 1024;
export const MAX_ROSTER_CSV_ROWS = 1000;

export const BLOCKING_PREVIEW_CATEGORIES = new Set<RosterImportPreviewCategory>([
  "duplicate_candidate",
  "attendance_collision",
  "rejected_row",
]);

export interface ParsedRosterCsvRow {
  rowNumber: number;
  raw: Record<string, string>;
}

export interface ExistingRosterStudent {
  studentId: string;
  studentCode: string;
  displayName: string;
  attendanceNumber: string | null;
  loginName: string | null;
  groupLabel: string | null;
  active: boolean;
}

export interface NormalizedRosterRow {
  studentCode: string;
  displayName: string;
  attendanceNumber: string | null;
  loginName: string;
  groupLabel: string | null;
  active: boolean;
}

export interface PreviewRowDraft {
  rowNumber: number;
  category: RosterImportPreviewCategory;
  studentId: string | null;
  proposed: Record<string, unknown>;
  issues: RosterImportRowIssue[];
}

function parseActive(raw: string | undefined): boolean | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = raw.trim().toLowerCase();
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  return null;
}

function normalizeRow(
  raw: Record<string, string>,
  rowNumber: number,
): {row?: NormalizedRosterRow; issues: RosterImportRowIssue[]} {
  const issues: RosterImportRowIssue[] = [];
  const extraColumns = Object.keys(raw).filter(
    key => !ROSTER_SHEET_COLUMNS.includes(key as (typeof ROSTER_SHEET_COLUMNS)[number]),
  );
  if (extraColumns.length > 0) {
    issues.push({
      code: "UNKNOWN_COLUMN",
      message: `Unknown columns: ${extraColumns.join(", ")}`,
    });
  }

  const studentCode = raw.student_code?.trim() ?? "";
  if (!studentCode) {
    issues.push({
      code: "MISSING_STUDENT_CODE",
      message: "student_code is required",
      field: "student_code",
    });
  }

  const displayName = raw.display_name?.trim() ?? "";
  if (!displayName) {
    issues.push({
      code: "MISSING_DISPLAY_NAME",
      message: "display_name is required",
      field: "display_name",
    });
  }

  const activeParsed = parseActive(raw.active);
  if (activeParsed === null) {
    issues.push({
      code: "INVALID_ACTIVE",
      message: 'active must be "true" or "false"',
      field: "active",
    });
  }

  if (issues.length > 0) {
    return {issues};
  }

  const attendanceRaw = raw.attendance_number?.trim() ?? "";
  const loginRaw = raw.login_name?.trim() ?? "";
  const groupRaw = raw.group_label?.trim() ?? "";

  return {
    row: {
      studentCode,
      displayName,
      attendanceNumber: attendanceRaw ? attendanceRaw : null,
      loginName: loginRaw || studentCode,
      groupLabel: groupRaw ? groupRaw : null,
      active: activeParsed!,
    },
    issues,
  };
}

export function parseRosterCsv(csvText: string): ParsedRosterCsvRow[] {
  const bytes = Buffer.byteLength(csvText, "utf8");
  if (bytes > MAX_ROSTER_CSV_BYTES) {
    throw new Error(`CSV exceeds ${MAX_ROSTER_CSV_BYTES} bytes`);
  }

  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
  }) as Array<Record<string, string>>;

  if (records.length > MAX_ROSTER_CSV_ROWS) {
    throw new Error(`CSV exceeds ${MAX_ROSTER_CSV_ROWS} data rows`);
  }

  return records.map((raw, index) => ({
    rowNumber: index + 2,
    raw,
  }));
}

function rowsEqual(a: NormalizedRosterRow, b: ExistingRosterStudent): boolean {
  return (
    a.displayName === b.displayName &&
    a.attendanceNumber === b.attendanceNumber &&
    a.loginName === (b.loginName ?? b.studentCode) &&
    a.groupLabel === b.groupLabel &&
    a.active === b.active
  );
}

export function buildImportPreviewRows(input: {
  parsedRows: ParsedRosterCsvRow[];
  existingStudents: ExistingRosterStudent[];
}): PreviewRowDraft[] {
  const byCode = new Map(
    input.existingStudents.map(student => [student.studentCode, student]),
  );
  const seenCodes = new Map<string, number>();
  const seenAttendance = new Map<string, string>();
  const csvCodes = new Set<string>();
  const drafts: PreviewRowDraft[] = [];

  for (const parsed of input.parsedRows) {
    const normalized = normalizeRow(parsed.raw, parsed.rowNumber);
    if (!normalized.row) {
      drafts.push({
        rowNumber: parsed.rowNumber,
        category: "rejected_row",
        studentId: null,
        proposed: parsed.raw,
        issues: normalized.issues,
      });
      continue;
    }

    const row = normalized.row;
    csvCodes.add(row.studentCode);

    if (seenCodes.has(row.studentCode)) {
      drafts.push({
        rowNumber: parsed.rowNumber,
        category: "duplicate_candidate",
        studentId: byCode.get(row.studentCode)?.studentId ?? null,
        proposed: {...row},
        issues: [
          {
            code: "DUPLICATE_STUDENT_CODE",
            message: `Duplicate student_code in import (first at row ${seenCodes.get(row.studentCode)})`,
            field: "student_code",
          },
        ],
      });
      continue;
    }
    seenCodes.set(row.studentCode, parsed.rowNumber);

    if (row.attendanceNumber) {
      const otherCode = seenAttendance.get(row.attendanceNumber);
      if (otherCode && otherCode !== row.studentCode) {
        drafts.push({
          rowNumber: parsed.rowNumber,
          category: "attendance_collision",
          studentId: byCode.get(row.studentCode)?.studentId ?? null,
          proposed: {...row},
          issues: [
            {
              code: "ATTENDANCE_COLLISION",
              message: `attendance_number ${row.attendanceNumber} already used in import`,
              field: "attendance_number",
            },
          ],
        });
        continue;
      }
      seenAttendance.set(row.attendanceNumber, row.studentCode);
    }

    const existing = byCode.get(row.studentCode);
    if (existing) {
      if (row.attendanceNumber) {
        const collision = input.existingStudents.find(
          student =>
            student.studentId !== existing.studentId &&
            student.active &&
            student.attendanceNumber === row.attendanceNumber,
        );
        if (collision) {
          drafts.push({
            rowNumber: parsed.rowNumber,
            category: "attendance_collision",
            studentId: existing.studentId,
            proposed: {...row},
            issues: [
              {
                code: "ATTENDANCE_COLLISION",
                message: `attendance_number ${row.attendanceNumber} already assigned`,
                field: "attendance_number",
              },
            ],
          });
          continue;
        }
      }

      if (!row.active && existing.active) {
        drafts.push({
          rowNumber: parsed.rowNumber,
          category: "deactivate",
          studentId: existing.studentId,
          proposed: {...row},
          issues: [],
        });
        continue;
      }

      if (rowsEqual(row, existing)) {
        drafts.push({
          rowNumber: parsed.rowNumber,
          category: "update",
          studentId: existing.studentId,
          proposed: {...row},
          issues: [],
        });
        continue;
      }

      drafts.push({
        rowNumber: parsed.rowNumber,
        category: "update",
        studentId: existing.studentId,
        proposed: {...row},
        issues: [],
      });
      continue;
    }

    if (row.attendanceNumber) {
      const collision = input.existingStudents.find(
        student => student.active && student.attendanceNumber === row.attendanceNumber,
      );
      if (collision) {
        drafts.push({
          rowNumber: parsed.rowNumber,
          category: "attendance_collision",
          studentId: null,
          proposed: {...row},
          issues: [
            {
              code: "ATTENDANCE_COLLISION",
              message: `attendance_number ${row.attendanceNumber} already assigned`,
              field: "attendance_number",
            },
          ],
        });
        continue;
      }
    }

    drafts.push({
      rowNumber: parsed.rowNumber,
      category: row.active ? "add" : "rejected_row",
      studentId: null,
      proposed: {...row},
      issues: row.active
        ? []
        : [{code: "INACTIVE_ADD", message: "Cannot add inactive student", field: "active"}],
    });
  }

  for (const existing of input.existingStudents) {
    if (!existing.active || csvCodes.has(existing.studentCode)) continue;
    drafts.push({
      rowNumber: 0,
      category: "deactivate",
      studentId: existing.studentId,
      proposed: {
        studentCode: existing.studentCode,
        displayName: existing.displayName,
        attendanceNumber: existing.attendanceNumber,
        loginName: existing.loginName,
        groupLabel: existing.groupLabel,
        active: false,
      },
      issues: [],
    });
  }

  return drafts.sort((a, b) => a.rowNumber - b.rowNumber);
}

export function computePreviewHash(input: {
  baseRosterRevision: number;
  rows: readonly Pick<
    PreviewRowDraft,
    "rowNumber" | "category" | "studentId" | "proposed"
  >[];
}): string {
  const canonical = {
    baseRosterRevision: input.baseRosterRevision,
    rows: input.rows.map(row => ({
      rowNumber: row.rowNumber,
      category: row.category,
      studentId: row.studentId,
      proposed: row.proposed,
    })),
  };
  return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}

export function previewRowsToContract(
  importId: string,
  drafts: PreviewRowDraft[],
  rowIds: string[],
): RosterImportPreviewRow[] {
  return drafts.map((draft, index) => ({
    rowId: rowIds[index]!,
    importId,
    rowNumber: draft.rowNumber,
    category: draft.category,
    studentId: draft.studentId,
    proposed: draft.proposed,
    issues: draft.issues,
  }));
}

export function hasBlockingPreviewRows(
  rows: readonly Pick<PreviewRowDraft, "category">[],
): boolean {
  return rows.some(row => BLOCKING_PREVIEW_CATEGORIES.has(row.category));
}
