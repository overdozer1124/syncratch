/**
 * CSV roster import — parse, validate, preview categorization, preview_hash.
 */
import {createHash} from "node:crypto";
import {parse} from "csv-parse/sync";
import {
  ROSTER_SHEET_COLUMNS,
  canonicalRosterSheetHeader,
  isCanonicalRosterStudentCode,
  normalizeGoogleEmail,
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

const BLOCKING_ISSUE_CODES = new Set([
  "MISSING_STUDENT_CODE",
  "MISSING_DISPLAY_NAME",
  "INVALID_ACTIVE",
  "INACTIVE_ADD",
  "CSV_PARSE_ERROR",
  "INVALID_GOOGLE_EMAIL",
  "DUPLICATE_GOOGLE_EMAIL",
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
  googleEmail: string | null;
  groupLabel: string | null;
  active: boolean;
}

export interface NormalizedRosterRow {
  studentCode: string;
  displayName: string;
  attendanceNumber: string | null;
  loginName: string;
  googleEmail: string | null;
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

export interface ImportPreviewBuildResult {
  rows: PreviewRowDraft[];
  ignoredColumns: string[];
  missingFromCsvCount: number;
}

export class RosterCsvParseError extends Error {
  constructor(readonly rejectedRows: PreviewRowDraft[]) {
    super("CSV parse failed");
    this.name = "RosterCsvParseError";
  }
}

type ActiveParseResult = boolean | "invalid";

function parseActive(raw: string | undefined): ActiveParseResult {
  if (raw === undefined || raw.trim() === "") return true;
  const value = raw.trim().toLowerCase();
  if (value === "true" || value === "1" || value === "yes") return true;
  if (value === "false" || value === "0" || value === "no") return false;
  if (value === "有" || value === "有効" || value === "はい") return true;
  if (value === "無" || value === "無効" || value === "いいえ") return false;
  return "invalid";
}

function normalizeRow(
  raw: Record<string, string>,
): {row?: NormalizedRosterRow; issues: RosterImportRowIssue[]} {
  const issues: RosterImportRowIssue[] = [];
  const extraColumns = Object.keys(raw).filter(
    key => !ROSTER_SHEET_COLUMNS.includes(key as (typeof ROSTER_SHEET_COLUMNS)[number]),
  );
  if (extraColumns.length > 0) {
    issues.push({
      code: "UNKNOWN_COLUMN",
      message: `Unknown columns ignored: ${extraColumns.join(", ")}`,
    });
  }

  const studentCode = raw.student_code?.trim() ?? "";
  if (!studentCode) {
    issues.push({
      code: "MISSING_STUDENT_CODE",
      message: "student_code is required",
      field: "student_code",
    });
  } else if (!isCanonicalRosterStudentCode(studentCode)) {
    issues.push({
      code: "STUDENT_CODE_FORMAT",
      message:
        "student_code should be 6 digits ({YY}{grade}{class}{attendance}), e.g. 261101",
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
  if (activeParsed === "invalid") {
    issues.push({
      code: "INVALID_ACTIVE",
      message: 'active must be "true" or "false" when provided',
      field: "active",
    });
  }

  const blockingIssues = issues.filter(issue => BLOCKING_ISSUE_CODES.has(issue.code));
  if (blockingIssues.length > 0) {
    return {issues: blockingIssues.concat(issues.filter(i => !BLOCKING_ISSUE_CODES.has(i.code)))};
  }

  const attendanceRaw = raw.attendance_number?.trim() ?? "";
  const loginRaw = raw.login_name?.trim() ?? "";
  const googleEmailRaw = raw.google_email?.trim() ?? "";
  const groupRaw = raw.group_label?.trim() ?? "";

  let googleEmail: string | null = null;
  if (googleEmailRaw) {
    googleEmail = normalizeGoogleEmail(googleEmailRaw);
    if (!googleEmail) {
      issues.push({
        code: "INVALID_GOOGLE_EMAIL",
        message: "google_email must be a valid email address",
        field: "google_email",
      });
    }
  }

  const blockingAfterEmail = issues.filter(issue =>
    BLOCKING_ISSUE_CODES.has(issue.code),
  );
  if (blockingAfterEmail.length > 0) {
    return {
      issues: blockingAfterEmail.concat(
        issues.filter(i => !BLOCKING_ISSUE_CODES.has(i.code)),
      ),
    };
  }

  return {
    row: {
      studentCode,
      displayName,
      attendanceNumber: attendanceRaw ? attendanceRaw : null,
      loginName: loginRaw || studentCode,
      googleEmail,
      groupLabel: groupRaw ? groupRaw : null,
      active: activeParsed as boolean,
    },
    issues,
  };
}

export function collectIgnoredColumns(parsedRows: ParsedRosterCsvRow[]): string[] {
  const cols = new Set<string>();
  for (const parsed of parsedRows) {
    for (const key of Object.keys(parsed.raw)) {
      if (!ROSTER_SHEET_COLUMNS.includes(key as (typeof ROSTER_SHEET_COLUMNS)[number])) {
        cols.add(key);
      }
    }
  }
  return [...cols].sort();
}

export function parseRosterCsv(csvText: string): ParsedRosterCsvRow[] {
  const bytes = Buffer.byteLength(csvText, "utf8");
  if (bytes > MAX_ROSTER_CSV_BYTES) {
    throw new Error(`CSV exceeds ${MAX_ROSTER_CSV_BYTES} bytes`);
  }

  let records: Array<Record<string, string>>;
  try {
    records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      relax_quotes: false,
    }) as Array<Record<string, string>>;
  } catch (error) {
    const lineNumber =
      error &&
      typeof error === "object" &&
      "lines" in error &&
      typeof (error as {lines?: unknown}).lines === "number"
        ? (error as {lines: number}).lines
        : 1;
    throw new RosterCsvParseError([
      {
        rowNumber: lineNumber,
        category: "rejected_row",
        studentId: null,
        proposed: {},
        issues: [
          {
            code: "CSV_PARSE_ERROR",
            message:
              error instanceof Error ? error.message : "Malformed CSV row",
          },
        ],
      },
    ]);
  }

  if (records.length > MAX_ROSTER_CSV_ROWS) {
    throw new Error(`CSV exceeds ${MAX_ROSTER_CSV_ROWS} data rows`);
  }

  return records.map((raw, index) => ({
    rowNumber: index + 2,
    raw: Object.fromEntries(
      Object.entries(raw).map(([key, value]) => [
        canonicalRosterSheetHeader(key),
        value,
      ]),
    ),
  }));
}

function rowsEqual(a: NormalizedRosterRow, b: ExistingRosterStudent): boolean {
  return (
    a.displayName === b.displayName &&
    a.attendanceNumber === b.attendanceNumber &&
    a.loginName === (b.loginName ?? b.studentCode) &&
    a.googleEmail === b.googleEmail &&
    a.groupLabel === b.groupLabel &&
    a.active === b.active
  );
}

function findGoogleEmailCollision(
  googleEmail: string,
  existingStudents: ExistingRosterStudent[],
  excludeStudentId: string | null,
): ExistingRosterStudent | undefined {
  return existingStudents.find(
    student =>
      student.googleEmail === googleEmail &&
      student.studentId !== excludeStudentId,
  );
}

export function buildImportPreviewRows(input: {
  parsedRows: ParsedRosterCsvRow[];
  /** All owner students for student_code lookup. */
  existingStudents: ExistingRosterStudent[];
  /** Roster members used for implicit deactivate when absent from CSV. */
  rosterMembers?: ExistingRosterStudent[];
  /** When true, active roster members missing from CSV become deactivate rows. Default false. */
  deactivateMissing?: boolean;
}): ImportPreviewBuildResult {
  const rosterMembers = input.rosterMembers ?? input.existingStudents;
  const deactivateMissing = input.deactivateMissing ?? false;
  const byCode = new Map(
    input.existingStudents.map(student => [student.studentCode, student]),
  );
  const seenCodes = new Map<string, number>();
  const seenAttendance = new Map<string, string>();
  const seenGoogleEmails = new Map<string, string>();
  const csvCodes = new Set<string>();
  const drafts: PreviewRowDraft[] = [];

  for (const parsed of input.parsedRows) {
    const normalized = normalizeRow(parsed.raw);
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

    if (row.googleEmail) {
      const otherCode = seenGoogleEmails.get(row.googleEmail);
      if (otherCode && otherCode !== row.studentCode) {
        drafts.push({
          rowNumber: parsed.rowNumber,
          category: "duplicate_candidate",
          studentId: byCode.get(row.studentCode)?.studentId ?? null,
          proposed: {...row},
          issues: [
            {
              code: "DUPLICATE_GOOGLE_EMAIL",
              message: `Duplicate google_email in import (first at row ${seenGoogleEmails.get(row.googleEmail)})`,
              field: "google_email",
            },
          ],
        });
        continue;
      }
      seenGoogleEmails.set(row.googleEmail, row.studentCode);
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

      if (row.googleEmail) {
        const emailCollision = findGoogleEmailCollision(
          row.googleEmail,
          input.existingStudents,
          existing.studentId,
        );
        if (emailCollision) {
          drafts.push({
            rowNumber: parsed.rowNumber,
            category: "duplicate_candidate",
            studentId: existing.studentId,
            proposed: {...row},
            issues: [
              {
                code: "DUPLICATE_GOOGLE_EMAIL",
                message: `google_email ${row.googleEmail} already assigned to ${emailCollision.studentCode}`,
                field: "google_email",
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
          issues: normalized.issues,
        });
        continue;
      }

      if (rowsEqual(row, existing)) {
        drafts.push({
          rowNumber: parsed.rowNumber,
          category: "unchanged",
          studentId: existing.studentId,
          proposed: {...row},
          issues: normalized.issues,
        });
        continue;
      }

      drafts.push({
        rowNumber: parsed.rowNumber,
        category: "update",
        studentId: existing.studentId,
        proposed: {...row},
        issues: normalized.issues,
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

    if (row.googleEmail) {
      const emailCollision = findGoogleEmailCollision(
        row.googleEmail,
        input.existingStudents,
        null,
      );
      if (emailCollision) {
        drafts.push({
          rowNumber: parsed.rowNumber,
          category: "duplicate_candidate",
          studentId: null,
          proposed: {...row},
          issues: [
            {
              code: "DUPLICATE_GOOGLE_EMAIL",
              message: `google_email ${row.googleEmail} already assigned to ${emailCollision.studentCode}`,
              field: "google_email",
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
        ? normalized.issues
        : [
            ...normalized.issues,
            {code: "INACTIVE_ADD", message: "Cannot add inactive student", field: "active"},
          ],
    });
  }

  const missingFromCsvCount = rosterMembers.filter(
    member => member.active && !csvCodes.has(member.studentCode),
  ).length;

  if (deactivateMissing) {
    for (const existing of rosterMembers) {
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
  }

  return {
    rows: drafts.sort((a, b) => a.rowNumber - b.rowNumber),
    ignoredColumns: collectIgnoredColumns(input.parsedRows),
    missingFromCsvCount,
  };
}

export function computePreviewHash(input: {
  baseRosterRevision: number;
  deactivateMissing: boolean;
  rows: readonly Pick<
    PreviewRowDraft,
    "rowNumber" | "category" | "studentId" | "proposed"
  >[];
}): string {
  const canonical = {
    baseRosterRevision: input.baseRosterRevision,
    deactivateMissing: input.deactivateMissing,
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
