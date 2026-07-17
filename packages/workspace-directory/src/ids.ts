import {fail, issue, ok, type ValidationResult} from "./validation.js";

export type PersonId = string & {readonly __brand: "PersonId"};
export type UserAccountId = string & {readonly __brand: "UserAccountId"};
export type WorkspaceId = string & {readonly __brand: "WorkspaceId"};
export type SchoolId = string & {readonly __brand: "SchoolId"};
export type AcademicYearId = string & {readonly __brand: "AcademicYearId"};
export type GradeId = string & {readonly __brand: "GradeId"};
export type ClassGroupId = string & {readonly __brand: "ClassGroupId"};
export type EnrollmentId = string & {readonly __brand: "EnrollmentId"};
export type StaffAssignmentId = string & {
  readonly __brand: "StaffAssignmentId";
};
export type RoleAssignmentId = string & {
  readonly __brand: "RoleAssignmentId";
};
export type RosterImportId = string & {readonly __brand: "RosterImportId"};
export type RosterImportRowId = string & {
  readonly __brand: "RosterImportRowId";
};
export type AuditEventId = string & {readonly __brand: "AuditEventId"};
export type PersonAccountLinkId = string & {
  readonly __brand: "PersonAccountLinkId";
};
export type WorkspaceMembershipId = string & {
  readonly __brand: "WorkspaceMembershipId";
};

export type IsoDate = string & {readonly __brand: "IsoDate"};
export type UtcDateTime = string & {readonly __brand: "UtcDateTime"};
export type DirectoryRevision = number & {
  readonly __brand: "DirectoryRevision";
};

function createIdParser<T extends string>(name: string) {
  return (value: string): ValidationResult<T> => {
    const trimmed = value.trim();
    return trimmed.length > 0
      ? ok(trimmed as T)
      : fail([issue("invalid_id", `${name} must not be empty`)]);
  };
}

export const parsePersonId = createIdParser<PersonId>("PersonId");
export const parseUserAccountId =
  createIdParser<UserAccountId>("UserAccountId");
export const parseWorkspaceId = createIdParser<WorkspaceId>("WorkspaceId");
export const parseSchoolId = createIdParser<SchoolId>("SchoolId");
export const parseAcademicYearId =
  createIdParser<AcademicYearId>("AcademicYearId");
export const parseGradeId = createIdParser<GradeId>("GradeId");
export const parseClassGroupId =
  createIdParser<ClassGroupId>("ClassGroupId");
export const parseEnrollmentId =
  createIdParser<EnrollmentId>("EnrollmentId");
export const parseStaffAssignmentId =
  createIdParser<StaffAssignmentId>("StaffAssignmentId");
export const parseRoleAssignmentId =
  createIdParser<RoleAssignmentId>("RoleAssignmentId");
export const parseRosterImportId =
  createIdParser<RosterImportId>("RosterImportId");
export const parseRosterImportRowId =
  createIdParser<RosterImportRowId>("RosterImportRowId");
export const parseAuditEventId =
  createIdParser<AuditEventId>("AuditEventId");
export const parsePersonAccountLinkId =
  createIdParser<PersonAccountLinkId>("PersonAccountLinkId");
export const parseWorkspaceMembershipId =
  createIdParser<WorkspaceMembershipId>("WorkspaceMembershipId");

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UTC_DATE_TIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function parseIsoDate(value: string): ValidationResult<IsoDate> {
  if (!ISO_DATE_PATTERN.test(value)) {
    return fail([
      issue("invalid_iso_date", "IsoDate must use the YYYY-MM-DD format"),
    ]);
  }

  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString().slice(0, 10) !== value
  ) {
    return fail([issue("invalid_iso_date", "IsoDate must be a real date")]);
  }

  return ok(value as IsoDate);
}

export function parseUtcDateTime(
  value: string,
): ValidationResult<UtcDateTime> {
  if (!UTC_DATE_TIME_PATTERN.test(value)) {
    return fail([
      issue(
        "invalid_utc_date_time",
        "UtcDateTime must be an RFC 3339 UTC value with a Z suffix",
      ),
    ]);
  }

  const timestamp = Date.parse(value);
  const canonicalValue = value.includes(".")
    ? value
    : `${value.slice(0, -1)}.000Z`;
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== canonicalValue
  ) {
    return fail([
      issue("invalid_utc_date_time", "UtcDateTime must be a real instant"),
    ]);
  }

  return ok(value as UtcDateTime);
}

export function parseDirectoryRevision(
  value: number,
): ValidationResult<DirectoryRevision> {
  return Number.isSafeInteger(value) && value >= 0
    ? ok(value as DirectoryRevision)
    : fail([
        issue(
          "invalid_directory_revision",
          "DirectoryRevision must be a non-negative safe integer",
        ),
      ]);
}
