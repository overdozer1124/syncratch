/** Classroom roster and submission contracts (Community runtime; no frozen School import). */

export type StudentAccessMode = "shared-anonymous" | "roster-login";

export type ClassroomRosterSyncStatus = "active" | "sync_required";

export interface ClassroomRoster {
  rosterId: string;
  ownerAdminId: string;
  title: string;
  /** Google Spreadsheet ID selected by teacher (PR 2+). */
  sheetSpreadsheetId: string | null;
  sheetTabName: string | null;
  sheetRange: string | null;
  syncStatus: ClassroomRosterSyncStatus;
  rosterRevision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClassroomStudent {
  studentId: string;
  ownerAdminId: string;
  /** Opaque stable code from Sheet column `student_code`. */
  studentCode: string;
  displayName: string;
  attendanceNumber: string | null;
  loginName: string | null;
  groupLabel: string | null;
  active: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RosterMembership {
  membershipId: string;
  rosterId: string;
  studentId: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type StudentAccountStatus =
  | "pending_activation"
  | "active"
  | "disabled";

export interface StudentAuthPolicy {
  required: boolean;
}

export interface SubmissionPolicy {
  enabled: boolean;
}

export type SubmissionStatus = "submitted" | "failed";

export interface SubmissionListItem {
  submissionId: string;
  policyId: string;
  studentId: string;
  studentCode: string;
  displayName: string;
  attendanceNumber: string | null;
  projectTitle: string;
  submittedAt: string;
  isResubmission: boolean;
  sizeBytes: number;
  status: SubmissionStatus;
}

/** Sheet column contract (Google Sheet is source of truth for roster fields). */
export const ROSTER_SHEET_COLUMNS = [
  "student_code",
  "display_name",
  "attendance_number",
  "login_name",
  "group_label",
  "active",
] as const;

export type RosterSheetColumn = (typeof ROSTER_SHEET_COLUMNS)[number];

/** Japanese labels for teacher-facing Sheet / CSV headers. */
export const ROSTER_SHEET_COLUMN_LABELS: Record<RosterSheetColumn, string> = {
  student_code: "生徒コード",
  display_name: "氏名",
  attendance_number: "出席番号",
  login_name: "ログイン名",
  group_label: "グループ",
  active: "有効",
};

const ROSTER_SHEET_HEADER_ALIAS_ENTRIES: Array<[string, RosterSheetColumn]> =
  ROSTER_SHEET_COLUMNS.flatMap(column => [
    [column, column],
    [ROSTER_SHEET_COLUMN_LABELS[column], column],
  ]);

export const ROSTER_SHEET_HEADER_ALIASES: Readonly<Record<string, RosterSheetColumn>> =
  Object.fromEntries(ROSTER_SHEET_HEADER_ALIAS_ENTRIES);

/** Map a Sheet/CSV header cell to the canonical English column key. */
export function canonicalRosterSheetHeader(header: string): string {
  const trimmed = header.trim();
  return ROSTER_SHEET_HEADER_ALIASES[trimmed] ?? trimmed;
}

export function rosterSheetTemplateHeaders(): readonly string[] {
  return ROSTER_SHEET_COLUMNS.map(column => ROSTER_SHEET_COLUMN_LABELS[column]);
}

export type RosterImportPreviewCategory =
  | "add"
  | "update"
  | "unchanged"
  | "deactivate"
  | "duplicate_candidate"
  | "attendance_collision"
  | "rejected_row";

export interface RosterImportRowIssue {
  code: string;
  message: string;
  field?: string;
}

export type RosterImportStatus =
  | "uploaded"
  | "validated"
  | "preview_ready"
  | "applied"
  | "failed"
  | "discarded";

export interface RosterImport {
  importId: string;
  rosterId: string;
  status: RosterImportStatus;
  uploadedAt: string;
  previewHash: string | null;
  baseRosterRevision: number | null;
  appliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RosterImportPreviewRow {
  rowId: string;
  importId: string;
  rowNumber: number;
  category: RosterImportPreviewCategory;
  studentId: string | null;
  proposed: Readonly<Record<string, unknown>>;
  issues: readonly RosterImportRowIssue[];
}

export interface RosterImportPreview {
  import: RosterImport;
  rows: readonly RosterImportPreviewRow[];
  previewHash: string;
  baseRosterRevision: number;
  /** Columns present in CSV but outside ROSTER_SHEET_COLUMNS (ignored at import). */
  ignoredColumns: readonly string[];
  /** Active roster members absent from CSV row set (informational). */
  missingFromCsvCount: number;
  /** Whether absent members are previewed as deactivate (default false). */
  deactivateMissing: boolean;
}

/** Admin API DTOs (PR 3+). */
export interface ClassroomRosterInput {
  title?: string;
  sheetSpreadsheetId?: string | null;
  sheetTabName?: string | null;
  sheetRange?: string | null;
}

export interface ClassroomStudentInput {
  studentCode?: string;
  displayName?: string;
  attendanceNumber?: string | null;
  loginName?: string | null;
  groupLabel?: string | null;
  active?: boolean;
}

export interface ClassroomRosterListItem {
  rosterId: string;
  title: string;
  syncStatus: ClassroomRosterSyncStatus;
  rosterRevision: number;
  studentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ClassroomStudentListItem {
  studentId: string;
  studentCode: string;
  displayName: string;
  attendanceNumber: string | null;
  loginName: string | null;
  groupLabel: string | null;
  active: boolean;
  accountStatus: StudentAccountStatus | null;
  createdAt: string;
  updatedAt: string;
}

export interface RosterSyncResult {
  rosterId: string;
  rosterRevision: number;
  syncStatus: ClassroomRosterSyncStatus;
  syncedAt: string;
}

export interface SubmissionDetail extends SubmissionListItem {
  contentSha256: string;
  driveFileId: string | null;
}
