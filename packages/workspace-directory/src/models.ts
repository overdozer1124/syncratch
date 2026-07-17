import {
  parseDirectoryRevision,
  parseIsoDate,
  parseUtcDateTime,
  type AcademicYearId,
  type AuditEventId,
  type ClassGroupId,
  type DirectoryRevision,
  type EnrollmentId,
  type GradeId,
  type IsoDate,
  type PersonAccountLinkId,
  type PersonId,
  type RoleAssignmentId,
  type SchoolId,
  type StaffAssignmentId,
  type UserAccountId,
  type UtcDateTime,
  type WorkspaceId,
  type WorkspaceMembershipId,
} from "./ids.js";
import {
  fail,
  issue,
  ok,
  type ValidationIssue,
  type ValidationResult,
} from "./validation.js";

export type PersonStatus = "active" | "disabled" | "archived";

export interface Person {
  id: PersonId;
  displayName: string;
  status: PersonStatus;
  createdAt: UtcDateTime;
  updatedAt: UtcDateTime;
}

export type PersonAccountLinkStatus = "active" | "unlinked";

export interface PersonAccountLink {
  id: PersonAccountLinkId;
  personId: PersonId;
  accountId: UserAccountId;
  status: PersonAccountLinkStatus;
  linkedAt: UtcDateTime;
  unlinkedAt: UtcDateTime | null;
}

export type WorkspaceKind = "personal" | "casual" | "school";

export interface Workspace {
  id: WorkspaceId;
  kind: WorkspaceKind;
  name: string;
  createdAt: UtcDateTime;
  updatedAt: UtcDateTime;
}

export type WorkspaceMembershipRole = "owner" | "admin" | "member" | "guest";
export type WorkspaceMembershipStatus = "active" | "ended";

export interface WorkspaceMembership {
  id: WorkspaceMembershipId;
  workspaceId: WorkspaceId;
  accountId: UserAccountId;
  role: WorkspaceMembershipRole;
  status: WorkspaceMembershipStatus;
  startedAt: UtcDateTime;
  endedAt: UtcDateTime | null;
}

export interface School {
  id: SchoolId;
  workspaceId: WorkspaceId;
  name: string;
  createdAt: UtcDateTime;
  updatedAt: UtcDateTime;
}

export type AcademicYearStatus = "planned" | "active" | "closed";

export interface AcademicYear {
  id: AcademicYearId;
  schoolId: SchoolId;
  label: string;
  startDate: IsoDate;
  endDate: IsoDate;
  status: AcademicYearStatus;
}

export interface Grade {
  id: GradeId;
  academicYearId: AcademicYearId;
  code: string;
  displayLabel: string;
  sortOrder: number;
}

export interface ClassGroup {
  id: ClassGroupId;
  academicYearId: AcademicYearId;
  gradeId: GradeId;
  label: string;
}

export type EnrollmentStatus = "active" | "ended";

export interface Enrollment {
  id: EnrollmentId;
  personId: PersonId;
  classGroupId: ClassGroupId;
  status: EnrollmentStatus;
  startDate: IsoDate;
  endDate: IsoDate | null;
  attendanceNumber: string | null;
}

export type StaffAssignmentRole = "teacher" | "assistant";
export type StaffAssignmentStatus = "active" | "ended";

export interface StaffAssignment {
  id: StaffAssignmentId;
  personId: PersonId;
  classGroupId: ClassGroupId;
  role: StaffAssignmentRole;
  status: StaffAssignmentStatus;
  startDate: IsoDate;
  endDate: IsoDate | null;
}

export type AccessScope =
  | {kind: "system"}
  | {kind: "workspace"; workspaceId: WorkspaceId}
  | {kind: "school"; schoolId: SchoolId}
  | {kind: "class"; classGroupId: ClassGroupId}
  | {kind: "project"; projectId: string};

export type SystemRole = "owner" | "operator";
export type WorkspaceRole = "owner" | "admin" | "member" | "guest";
export type SchoolRole = "school_admin" | "staff" | "student";
export type ClassRole = "teacher" | "assistant" | "student";
export type ProjectRole =
  | "owner"
  | "host"
  | "editor"
  | "commenter"
  | "viewer";

interface RoleAssignmentFields {
  id: RoleAssignmentId;
  accountId: UserAccountId;
  status: "active" | "ended";
  startedAt: UtcDateTime;
  endedAt: UtcDateTime | null;
}

export type RoleAssignment =
  | (RoleAssignmentFields & {
      scope: {kind: "system"};
      role: SystemRole;
    })
  | (RoleAssignmentFields & {
      scope: {kind: "workspace"; workspaceId: WorkspaceId};
      role: WorkspaceRole;
    })
  | (RoleAssignmentFields & {
      scope: {kind: "school"; schoolId: SchoolId};
      role: SchoolRole;
    })
  | (RoleAssignmentFields & {
      scope: {kind: "class"; classGroupId: ClassGroupId};
      role: ClassRole;
    })
  | (RoleAssignmentFields & {
      scope: {kind: "project"; projectId: string};
      role: ProjectRole;
    });

export interface AuditEvent {
  id: AuditEventId;
  workspaceId: WorkspaceId | null;
  actorAccountId: UserAccountId | null;
  action: string;
  subjectType: string;
  subjectId: string;
  payload: Readonly<Record<string, unknown>>;
  createdAt: UtcDateTime;
  directoryRevision: DirectoryRevision;
}

function addNonEmpty(
  issues: ValidationIssue[],
  value: unknown,
  path: string,
): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(issue("required", `${path} must not be empty`, path));
  }
}

function addEnum<T extends string>(
  issues: ValidationIssue[],
  value: unknown,
  allowed: readonly T[],
  path: string,
): void {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    issues.push(issue("invalid_value", `${path} is invalid`, path));
  }
}

function addUtcDateTime(
  issues: ValidationIssue[],
  value: unknown,
  path: string,
): void {
  if (
    typeof value !== "string" ||
    !parseUtcDateTime(value).ok
  ) {
    issues.push(issue("invalid_utc_date_time", `${path} is invalid`, path));
  }
}

function addIsoDate(
  issues: ValidationIssue[],
  value: unknown,
  path: string,
): void {
  if (typeof value !== "string" || !parseIsoDate(value).ok) {
    issues.push(issue("invalid_iso_date", `${path} is invalid`, path));
  }
}

function addOrderedValues(
  issues: ValidationIssue[],
  start: unknown,
  end: unknown,
  startPath: string,
  endPath: string,
): void {
  if (typeof start !== "string" || typeof end !== "string") {
    return;
  }

  const outOfOrder =
    start.includes("T") && end.includes("T")
      ? Date.parse(start) > Date.parse(end)
      : start > end;
  if (outOfOrder) {
    issues.push(
      issue(
        "invalid_date_order",
        `${startPath} must be before or equal to ${endPath}`,
        endPath,
      ),
    );
  }
}

function addHistoryEndConsistency(
  issues: ValidationIssue[],
  status: unknown,
  end: unknown,
  path: string,
): void {
  if (status === "active" && end !== null) {
    issues.push(issue("active_has_end", `active rows require null ${path}`, path));
  } else if (
    (status === "ended" || status === "unlinked") &&
    end === null
  ) {
    issues.push(
      issue("ended_without_end", `${status} rows require ${path}`, path),
    );
  }
}

function finish<T>(
  value: T,
  issues: readonly ValidationIssue[],
): ValidationResult<T> {
  return issues.length === 0 ? ok(value) : fail(issues);
}

function addEntityId(
  issues: ValidationIssue[],
  value: unknown,
  path = "id",
): void {
  addNonEmpty(issues, value, path);
}

export function validatePerson(value: Person): ValidationResult<Person> {
  const issues: ValidationIssue[] = [];
  addEntityId(issues, value.id);
  addNonEmpty(issues, value.displayName, "displayName");
  addEnum(issues, value.status, ["active", "disabled", "archived"], "status");
  addUtcDateTime(issues, value.createdAt, "createdAt");
  addUtcDateTime(issues, value.updatedAt, "updatedAt");
  addOrderedValues(
    issues,
    value.createdAt,
    value.updatedAt,
    "createdAt",
    "updatedAt",
  );
  return finish(value, issues);
}

export function validatePersonAccountLink(
  value: PersonAccountLink,
): ValidationResult<PersonAccountLink> {
  const issues: ValidationIssue[] = [];
  addEntityId(issues, value.id);
  addNonEmpty(issues, value.personId, "personId");
  addNonEmpty(issues, value.accountId, "accountId");
  addEnum(issues, value.status, ["active", "unlinked"], "status");
  addUtcDateTime(issues, value.linkedAt, "linkedAt");
  if (value.unlinkedAt !== null) {
    addUtcDateTime(issues, value.unlinkedAt, "unlinkedAt");
    addOrderedValues(
      issues,
      value.linkedAt,
      value.unlinkedAt,
      "linkedAt",
      "unlinkedAt",
    );
  }
  addHistoryEndConsistency(issues, value.status, value.unlinkedAt, "unlinkedAt");
  return finish(value, issues);
}

export function validateWorkspace(
  value: Workspace,
): ValidationResult<Workspace> {
  const issues: ValidationIssue[] = [];
  addEntityId(issues, value.id);
  addEnum(issues, value.kind, ["personal", "casual", "school"], "kind");
  addNonEmpty(issues, value.name, "name");
  addUtcDateTime(issues, value.createdAt, "createdAt");
  addUtcDateTime(issues, value.updatedAt, "updatedAt");
  addOrderedValues(
    issues,
    value.createdAt,
    value.updatedAt,
    "createdAt",
    "updatedAt",
  );
  return finish(value, issues);
}

export function validateWorkspaceMembership(
  value: WorkspaceMembership,
): ValidationResult<WorkspaceMembership> {
  const issues: ValidationIssue[] = [];
  addEntityId(issues, value.id);
  addNonEmpty(issues, value.workspaceId, "workspaceId");
  addNonEmpty(issues, value.accountId, "accountId");
  addEnum(issues, value.role, ["owner", "admin", "member", "guest"], "role");
  addEnum(issues, value.status, ["active", "ended"], "status");
  addUtcDateTime(issues, value.startedAt, "startedAt");
  if (value.endedAt !== null) {
    addUtcDateTime(issues, value.endedAt, "endedAt");
    addOrderedValues(
      issues,
      value.startedAt,
      value.endedAt,
      "startedAt",
      "endedAt",
    );
  }
  addHistoryEndConsistency(issues, value.status, value.endedAt, "endedAt");
  return finish(value, issues);
}

export function validateSchool(value: School): ValidationResult<School> {
  const issues: ValidationIssue[] = [];
  addEntityId(issues, value.id);
  addNonEmpty(issues, value.workspaceId, "workspaceId");
  addNonEmpty(issues, value.name, "name");
  addUtcDateTime(issues, value.createdAt, "createdAt");
  addUtcDateTime(issues, value.updatedAt, "updatedAt");
  addOrderedValues(
    issues,
    value.createdAt,
    value.updatedAt,
    "createdAt",
    "updatedAt",
  );
  return finish(value, issues);
}

export function validateAcademicYear(
  value: AcademicYear,
): ValidationResult<AcademicYear> {
  const issues: ValidationIssue[] = [];
  addEntityId(issues, value.id);
  addNonEmpty(issues, value.schoolId, "schoolId");
  addNonEmpty(issues, value.label, "label");
  addIsoDate(issues, value.startDate, "startDate");
  addIsoDate(issues, value.endDate, "endDate");
  addOrderedValues(
    issues,
    value.startDate,
    value.endDate,
    "startDate",
    "endDate",
  );
  addEnum(issues, value.status, ["planned", "active", "closed"], "status");
  return finish(value, issues);
}

export function validateGrade(value: Grade): ValidationResult<Grade> {
  const issues: ValidationIssue[] = [];
  addEntityId(issues, value.id);
  addNonEmpty(issues, value.academicYearId, "academicYearId");
  addNonEmpty(issues, value.code, "code");
  addNonEmpty(issues, value.displayLabel, "displayLabel");
  if (!Number.isSafeInteger(value.sortOrder) || value.sortOrder < 0) {
    issues.push(
      issue(
        "invalid_sort_order",
        "sortOrder must be a non-negative safe integer",
        "sortOrder",
      ),
    );
  }
  return finish(value, issues);
}

export function validateClassGroup(
  value: ClassGroup,
): ValidationResult<ClassGroup> {
  const issues: ValidationIssue[] = [];
  addEntityId(issues, value.id);
  addNonEmpty(issues, value.academicYearId, "academicYearId");
  addNonEmpty(issues, value.gradeId, "gradeId");
  addNonEmpty(issues, value.label, "label");
  return finish(value, issues);
}

export function validateEnrollment(
  value: Enrollment,
): ValidationResult<Enrollment> {
  const issues: ValidationIssue[] = [];
  addEntityId(issues, value.id);
  addNonEmpty(issues, value.personId, "personId");
  addNonEmpty(issues, value.classGroupId, "classGroupId");
  addEnum(issues, value.status, ["active", "ended"], "status");
  addIsoDate(issues, value.startDate, "startDate");
  if (value.endDate !== null) {
    addIsoDate(issues, value.endDate, "endDate");
    addOrderedValues(
      issues,
      value.startDate,
      value.endDate,
      "startDate",
      "endDate",
    );
  }
  addHistoryEndConsistency(issues, value.status, value.endDate, "endDate");
  if (value.attendanceNumber !== null) {
    addNonEmpty(issues, value.attendanceNumber, "attendanceNumber");
  }
  return finish(value, issues);
}

export function validateStaffAssignment(
  value: StaffAssignment,
): ValidationResult<StaffAssignment> {
  const issues: ValidationIssue[] = [];
  addEntityId(issues, value.id);
  addNonEmpty(issues, value.personId, "personId");
  addNonEmpty(issues, value.classGroupId, "classGroupId");
  addEnum(issues, value.role, ["teacher", "assistant"], "role");
  addEnum(issues, value.status, ["active", "ended"], "status");
  addIsoDate(issues, value.startDate, "startDate");
  if (value.endDate !== null) {
    addIsoDate(issues, value.endDate, "endDate");
    addOrderedValues(
      issues,
      value.startDate,
      value.endDate,
      "startDate",
      "endDate",
    );
  }
  addHistoryEndConsistency(issues, value.status, value.endDate, "endDate");
  return finish(value, issues);
}

const ROLES_BY_SCOPE = {
  system: ["owner", "operator"],
  workspace: ["owner", "admin", "member", "guest"],
  school: ["school_admin", "staff", "student"],
  class: ["teacher", "assistant", "student"],
  project: ["owner", "host", "editor", "commenter", "viewer"],
} as const;

export function validateRoleAssignment(
  value: RoleAssignment,
): ValidationResult<RoleAssignment> {
  const issues: ValidationIssue[] = [];
  addEntityId(issues, value.id);
  addNonEmpty(issues, value.accountId, "accountId");
  addEnum(issues, value.status, ["active", "ended"], "status");
  addUtcDateTime(issues, value.startedAt, "startedAt");
  if (value.endedAt !== null) {
    addUtcDateTime(issues, value.endedAt, "endedAt");
    addOrderedValues(
      issues,
      value.startedAt,
      value.endedAt,
      "startedAt",
      "endedAt",
    );
  }
  addHistoryEndConsistency(issues, value.status, value.endedAt, "endedAt");

  const scope = value.scope as AccessScope | undefined;
  const kind = scope?.kind;
  if (
    !scope ||
    (kind !== "system" &&
      kind !== "workspace" &&
      kind !== "school" &&
      kind !== "class" &&
      kind !== "project")
  ) {
    issues.push(issue("invalid_scope", "scope.kind is invalid", "scope.kind"));
  } else {
    addEnum(issues, value.role, ROLES_BY_SCOPE[kind], "role");
    if (kind === "workspace") {
      addNonEmpty(issues, scope.workspaceId, "scope.workspaceId");
    } else if (kind === "school") {
      addNonEmpty(issues, scope.schoolId, "scope.schoolId");
    } else if (kind === "class") {
      addNonEmpty(issues, scope.classGroupId, "scope.classGroupId");
    } else if (kind === "project") {
      addNonEmpty(issues, scope.projectId, "scope.projectId");
    }
  }

  return finish(value, issues);
}

export function validateAuditEvent(
  value: AuditEvent,
): ValidationResult<AuditEvent> {
  const issues: ValidationIssue[] = [];
  addEntityId(issues, value.id);
  if (value.workspaceId !== null) {
    addNonEmpty(issues, value.workspaceId, "workspaceId");
  }
  if (value.actorAccountId !== null) {
    addNonEmpty(issues, value.actorAccountId, "actorAccountId");
  }
  addNonEmpty(issues, value.action, "action");
  addNonEmpty(issues, value.subjectType, "subjectType");
  addNonEmpty(issues, value.subjectId, "subjectId");
  if (
    value.payload === null ||
    typeof value.payload !== "object" ||
    Array.isArray(value.payload)
  ) {
    issues.push(issue("invalid_payload", "payload must be a record", "payload"));
  }
  addUtcDateTime(issues, value.createdAt, "createdAt");
  if (
    typeof value.directoryRevision !== "number" ||
    !parseDirectoryRevision(value.directoryRevision).ok
  ) {
    issues.push(
      issue(
        "invalid_directory_revision",
        "directoryRevision is invalid",
        "directoryRevision",
      ),
    );
  }
  return finish(value, issues);
}
