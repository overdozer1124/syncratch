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

export type RosterImportPreviewCategory =
  | "add"
  | "update"
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
