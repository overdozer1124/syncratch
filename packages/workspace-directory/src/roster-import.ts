import {
  parseDirectoryRevision,
  parseRosterImportId,
  type DirectoryRevision,
  type PersonId,
  type RosterImportId,
  type RosterImportRowId,
  type SchoolId,
  type UtcDateTime,
  type WorkspaceId,
} from "./ids.js";
import {
  fail,
  issue,
  ok,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

export type RosterPreviewCategory =
  | "add_person"
  | "update_display_fields"
  | "new_enrollment"
  | "class_move"
  | "end_enrollment"
  | "duplicate_candidate"
  | "attendance_collision"
  | "ambiguous_account_link"
  | "rejected_row";

export interface RosterImportRowIssue {
  code: string;
  message: string;
  field?: string;
}

export interface RosterImportRow {
  id: RosterImportRowId;
  importId: RosterImportId;
  rowNumber: number;
  category: RosterPreviewCategory;
  personId: PersonId | null;
  proposed: Readonly<Record<string, unknown>>;
  issues: readonly RosterImportRowIssue[];
}

export type RosterImportStatus =
  | "uploaded"
  | "validated"
  | "preview_ready"
  | "applied"
  | "failed"
  | "discarded";

export interface RosterImport {
  id: RosterImportId;
  workspaceId: WorkspaceId;
  schoolId: SchoolId;
  status: RosterImportStatus;
  uploadedAt: UtcDateTime;
  previewHash: string | null;
  baseDirectoryRevision: DirectoryRevision | null;
  appliedAt: UtcDateTime | null;
}

export interface RosterImportPreview {
  import: RosterImport;
  rows: readonly RosterImportRow[];
  previewHash: string;
  baseDirectoryRevision: DirectoryRevision;
}

export interface RosterImportApplyRequest {
  importId: RosterImportId;
  previewHash: string;
  baseDirectoryRevision: DirectoryRevision;
}

const PREVIEW_HASH_PATTERN = /^[0-9a-f]{64}$/;

export function parsePreviewHash(value: string): ValidationResult<string> {
  return PREVIEW_HASH_PATTERN.test(value)
    ? ok(value)
    : fail([
        issue(
          "invalid_preview_hash",
          "previewHash must be a lowercase hex SHA-256 digest",
          "previewHash",
        ),
      ]);
}

export function validateRosterImportApplyRequest(
  value: RosterImportApplyRequest,
): ValidationResult<RosterImportApplyRequest> {
  const issues: ValidationIssue[] = [];

  const importId = parseRosterImportId(value.importId);
  if (!importId.ok) {
    issues.push(
      ...importId.issues.map((item) =>
        item.path === undefined ? {...item, path: "importId"} : item,
      ),
    );
  }

  const previewHash = parsePreviewHash(value.previewHash);
  if (!previewHash.ok) {
    issues.push(...previewHash.issues);
  }

  const revision = parseDirectoryRevision(value.baseDirectoryRevision);
  if (!revision.ok) {
    issues.push(
      ...revision.issues.map((item) =>
        item.path === undefined
          ? {...item, path: "baseDirectoryRevision"}
          : item,
      ),
    );
  }

  return issues.length === 0 ? ok(value) : fail(issues);
}
