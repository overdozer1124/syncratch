# R1 Workspace Directory Domain Contracts Design

> **Status:** Approved by user on 2026-07-17 — implementation not started
>
> **Approval basis:** brainstorming sections approved in-session; written spec
> committed at `e3e9a9b`; user directed plan execution to completion
>
> **Parent design:** `docs/superpowers/specs/2026-07-16-r1-workspace-roster-access-design.md`
>
> **Roadmap:** `docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md` Phase 1 Task 1
>
> **Prior slice (frozen):** R1 Versioned SQLite Migration Ledger @ `9b940f35b0b809daf9fa6d7e567da9d8565c0c08`

## 1. Decision

The next independently reviewable R1 slice defines a pure TypeScript package
`@blocksync/workspace-directory` that freezes domain IDs, entity models,
scoped role/capability evaluation, roster-import contracts, validation results,
and conflict detectors.

This slice does not create SQLite tables, migration `0002`, repositories, HTTP
routes, UI, or authentication cutover. Deterministic Person ID generation is
recorded as a later migration concern and is not implemented here.

## 2. Goals

1. Separate roster identity (`Person`) from authentication identity
   (`UserAccount`) in typed contracts.
2. Model multi-workspace membership and school roster history without school
   setup being mandatory for personal/casual use.
3. Encode scoped authorization as closed, operation-level capabilities with
   deny-by-default evaluation.
4. Ensure teacher/student facts never satisfy system or project capabilities
   unless an explicit `RoleAssignment` grants them.
5. Provide structured validation and conflict detection usable by later
   repositories and services without SQLite or Hono imports.
6. Keep the package acyclic: no dependency on `@blocksync/project-store-sqlite`,
   auth adapters, or React.

## 3. Non-goals

- SQLite DDL, `schema_migrations` version 2+, or legacy backfill
- Repository ports or adapters
- Hono routes, cookies, CSRF, or session migration
- Management UI or CSV upload I/O
- Deterministic Person ID algorithm, namespace UUID, or golden vectors
- Guest invitation / guest-principal flows (vocabulary only; Release 3)
- Project invitation / host-transfer APIs (vocabulary must not block them)
- AI provider configuration beyond capability placeholders already listed

## 4. Package layout

```text
packages/workspace-directory/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts
    ids.ts
    models.ts
    access.ts
    roster-import.ts
    validation.ts
    conflicts.ts
    *.test.ts
```

Public exports are limited to types and pure functions from `src/index.ts`.
The package follows validation/result conventions from
`@blocksync/project-schema` and port-boundary discipline from
`@blocksync/session-service` (no SQLite in this package).

## 5. Primitive types

### 5.1 Branded IDs

Opaque branded string aliases. Construction validates non-empty trimmed UTF-8
and rejects whitespace-only values. No UUID algorithm is required in this
slice; callers supply already-allocated IDs.

| Brand | Purpose |
|---|---|
| `PersonId` | Roster person |
| `UserAccountId` | Authentication account |
| `WorkspaceId` | Workspace |
| `SchoolId` | School profile |
| `AcademicYearId` | Academic year |
| `GradeId` | Grade within a year |
| `ClassGroupId` | Class group |
| `EnrollmentId` | Enrollment history row |
| `StaffAssignmentId` | Staff assignment history row |
| `RoleAssignmentId` | Explicit role grant history row |
| `RosterImportId` | Import job |
| `RosterImportRowId` | Import row |
| `AuditEventId` | Audit event |
| `PersonAccountLinkId` | Account↔person link history row |
| `WorkspaceMembershipId` | Workspace membership history row |

### 5.2 Time and revision

- Calendar dates: `IsoDate` = `YYYY-MM-DD` (strict regex, no time zone).
- Instants: `UtcDateTime` = RFC 3339 UTC with `Z` suffix
  (example: `2026-07-17T12:00:00.000Z`).
- Directory optimistic concurrency: `DirectoryRevision` = non-negative integer
  (`number` that is a safe integer ≥ 0).

Open intervals use `endDate: IsoDate | null` where `null` means still active.

## 6. Domain models

### 6.1 Identity

```ts
type PersonStatus = "active" | "disabled" | "archived";

interface Person {
  id: PersonId;
  displayName: string;
  status: PersonStatus;
  createdAt: UtcDateTime;
  updatedAt: UtcDateTime;
}

type PersonAccountLinkStatus = "active" | "unlinked";

interface PersonAccountLink {
  id: PersonAccountLinkId;
  personId: PersonId;
  accountId: UserAccountId;
  status: PersonAccountLinkStatus;
  linkedAt: UtcDateTime;
  unlinkedAt: UtcDateTime | null;
}
```

Rules:

- A `Person` may exist with zero accounts.
- At most one `active` link per `UserAccountId` across all people.
- At most one `active` link per `PersonId` across all accounts.
- Email equality never creates or implies a link.
- Unlinking sets `status = "unlinked"` and `unlinkedAt`; it does not delete
  history.
- Disabling/archiving a person does not cascade-delete enrollments or projects
  (projects are outside this package).

`UserAccount` itself remains owned by the auth slice. This package only
references `UserAccountId`.

### 6.2 Workspace and membership

```ts
type WorkspaceKind = "personal" | "casual" | "school";

interface Workspace {
  id: WorkspaceId;
  kind: WorkspaceKind;
  name: string;
  createdAt: UtcDateTime;
  updatedAt: UtcDateTime;
}

type WorkspaceMembershipRole = "owner" | "admin" | "member" | "guest";
type WorkspaceMembershipStatus = "active" | "ended";

interface WorkspaceMembership {
  id: WorkspaceMembershipId;
  workspaceId: WorkspaceId;
  accountId: UserAccountId;
  role: WorkspaceMembershipRole;
  status: WorkspaceMembershipStatus;
  startedAt: UtcDateTime;
  endedAt: UtcDateTime | null;
}
```

Rules:

- `guest` is reserved in the vocabulary; invitation/guest-principal flows are
  deferred to Release 3 and must not be implemented here.
- Membership role is workspace-scoped membership data, not the full
  capability matrix. Explicit `RoleAssignment` rows are the authorization
  source of truth for capability evaluation in this package.
- Ending membership sets `status = "ended"` and `endedAt`.

### 6.3 School roster

```ts
interface School {
  id: SchoolId;
  workspaceId: WorkspaceId;
  name: string;
  createdAt: UtcDateTime;
  updatedAt: UtcDateTime;
}

type AcademicYearStatus = "planned" | "active" | "closed";

interface AcademicYear {
  id: AcademicYearId;
  schoolId: SchoolId;
  label: string;
  startDate: IsoDate;
  endDate: IsoDate;
  status: AcademicYearStatus;
}

interface Grade {
  id: GradeId;
  academicYearId: AcademicYearId;
  code: string;
  displayLabel: string;
  sortOrder: number;
}

interface ClassGroup {
  id: ClassGroupId;
  academicYearId: AcademicYearId;
  gradeId: GradeId;
  label: string;
}

type EnrollmentStatus = "active" | "ended";

interface Enrollment {
  id: EnrollmentId;
  personId: PersonId;
  classGroupId: ClassGroupId;
  status: EnrollmentStatus;
  startDate: IsoDate;
  endDate: IsoDate | null;
  attendanceNumber: string | null;
}

type StaffAssignmentRole = "teacher" | "assistant";
type StaffAssignmentStatus = "active" | "ended";

interface StaffAssignment {
  id: StaffAssignmentId;
  personId: PersonId;
  classGroupId: ClassGroupId;
  role: StaffAssignmentRole;
  status: StaffAssignmentStatus;
  startDate: IsoDate;
  endDate: IsoDate | null;
}
```

Rules:

- `School` may exist only for `workspace.kind === "school"` (validated by
  callers supplying both records to a pure checker).
- Progression, transfer, graduation, and class changes close prior rows and
  create new history; they never overwrite prior facts.
- Attendance number is nullable. When present it must be unique among
  overlapping active enrollments in the same class (see §9).
- `Enrollment` and `StaffAssignment` are Person facts. They never produce
  capabilities by themselves.

### 6.4 Role assignment

```ts
type AccessScope =
  | { kind: "system" }
  | { kind: "workspace"; workspaceId: WorkspaceId }
  | { kind: "school"; schoolId: SchoolId }
  | { kind: "class"; classGroupId: ClassGroupId }
  | { kind: "project"; projectId: string };

type SystemRole = "owner" | "operator";
type WorkspaceRole = "owner" | "admin" | "member" | "guest";
type SchoolRole = "school_admin" | "staff" | "student";
type ClassRole = "teacher" | "assistant" | "student";
type ProjectRole = "owner" | "host" | "editor" | "commenter" | "viewer";

type RoleAssignment =
  | {
      id: RoleAssignmentId;
      accountId: UserAccountId;
      scope: { kind: "system" };
      role: SystemRole;
      status: "active" | "ended";
      startedAt: UtcDateTime;
      endedAt: UtcDateTime | null;
    }
  | {
      id: RoleAssignmentId;
      accountId: UserAccountId;
      scope: { kind: "workspace"; workspaceId: WorkspaceId };
      role: WorkspaceRole;
      status: "active" | "ended";
      startedAt: UtcDateTime;
      endedAt: UtcDateTime | null;
    }
  | {
      id: RoleAssignmentId;
      accountId: UserAccountId;
      scope: { kind: "school"; schoolId: SchoolId };
      role: SchoolRole;
      status: "active" | "ended";
      startedAt: UtcDateTime;
      endedAt: UtcDateTime | null;
    }
  | {
      id: RoleAssignmentId;
      accountId: UserAccountId;
      scope: { kind: "class"; classGroupId: ClassGroupId };
      role: ClassRole;
      status: "active" | "ended";
      startedAt: UtcDateTime;
      endedAt: UtcDateTime | null;
    }
  | {
      id: RoleAssignmentId;
      accountId: UserAccountId;
      scope: { kind: "project"; projectId: string };
      role: ProjectRole;
      status: "active" | "ended";
      startedAt: UtcDateTime;
      endedAt: UtcDateTime | null;
    };
```

Rules:

- Role subjects are `UserAccountId` only.
- Scope and role are a discriminated union; invalid combinations are
  unrepresentable.
- Parent-scope inheritance is **not** performed by the evaluator. Callers
  that want inherited effect must resolve and pass the exact-scope
  assignments that apply.
- Last-owner protection is a service invariant for later slices; this package
  exposes helpers to count active owner assignments but does not mutate state.

### 6.5 Audit event

```ts
interface AuditEvent {
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
```

Audit write semantics (same sync transaction as mutations) belong to later
repository/service slices. This package only freezes the event shape.

## 7. Capabilities and evaluation

### 7.1 Closed capability union

```ts
type Capability =
  | "system.settings.read"
  | "system.settings.write"
  | "system.secrets.read"
  | "system.secrets.write"
  | "system.limits.read"
  | "system.limits.write"
  | "system.owner.transfer"
  | "workspace.settings.read"
  | "workspace.settings.write"
  | "workspace.members.read"
  | "workspace.members.manage"
  | "workspace.invites.manage"
  | "workspace.projects.create"
  | "school.settings.read"
  | "school.settings.write"
  | "school.roster.read"
  | "school.roster.manage"
  | "school.roster_claim.issue"
  | "school.permissions.manage"
  | "class.read"
  | "class.roster.read"
  | "class.roster.manage"
  | "class.assignment.manage"
  | "class.permissions.manage"
  | "project.read"
  | "project.edit"
  | "project.comment"
  | "project.members.manage"
  | "project.host.manage";
```

Unknown capability strings are rejected by validators and never grant access.

### 7.2 Role → capability templates

Evaluation expands only active assignments whose scope exactly matches the
requested scope.

| Scope | Role | Capabilities |
|---|---|---|
| system | owner | all `system.*` |
| system | operator | `system.settings.read`, `system.settings.write`, `system.limits.read`, `system.limits.write` (not secrets write/transfer) |
| workspace | owner | all `workspace.*` |
| workspace | admin | all `workspace.*` |
| workspace | member | `workspace.settings.read`, `workspace.members.read`, `workspace.projects.create` |
| workspace | guest | `workspace.settings.read` only |

Workspace owner vs admin distinction for last-owner transfer is a later
service invariant; both roles share the same workspace capability template
in this domain package. System owner transfer remains a `system.*`
capability only.
| school | school_admin | all `school.*` |
| school | staff | `school.settings.read`, `school.roster.read`, `school.roster.manage`, `school.roster_claim.issue` |
| school | student | `school.settings.read`, `school.roster.read` |
| class | teacher | all `class.*` |
| class | assistant | `class.read`, `class.roster.read`, `class.roster.manage`, `class.assignment.manage` |
| class | student | `class.read`, `class.roster.read` |
| project | owner | all `project.*` |
| project | host | `project.read`, `project.edit`, `project.comment`, `project.members.manage`, `project.host.manage` |
| project | editor | `project.read`, `project.edit`, `project.comment` |
| project | commenter | `project.read`, `project.comment` |
| project | viewer | `project.read` |

### 7.3 Evaluator API

```ts
function capabilitiesForRole(
  scopeKind: AccessScope["kind"],
  role: string,
): ReadonlySet<Capability>;

function evaluateAccess(input: {
  assignments: readonly RoleAssignment[];
  accountId: UserAccountId;
  scope: AccessScope;
  capability: Capability;
  now: UtcDateTime;
}): boolean;
```

Semantics:

1. Ignore assignments that are not `status === "active"`.
2. Ignore assignments whose `accountId` differs.
3. Ignore assignments whose scope does not exactly equal the requested scope
   (deep equality of `kind` and id field).
4. Ignore assignments that ended before `now` if `endedAt` is set; active rows
   must have `endedAt === null`.
5. Grant if any remaining assignment's role template contains the capability.
6. Otherwise deny.

Anti-patterns enforced by tests:

- `StaffAssignment` / `Enrollment` objects are never accepted by
  `evaluateAccess`.
- Selecting school role `teacher`/`student` without a matching
  `RoleAssignment` grants nothing.
- A student with an explicit project `host` assignment receives only the
  project host capability set, never system/school/roster capabilities.

## 8. Roster import contracts

```ts
type RosterPreviewCategory =
  | "add_person"
  | "update_display_fields"
  | "new_enrollment"
  | "class_move"
  | "end_enrollment"
  | "duplicate_candidate"
  | "attendance_collision"
  | "ambiguous_account_link"
  | "rejected_row";

interface RosterImportRowIssue {
  code: string;
  message: string;
  field?: string;
}

interface RosterImportRow {
  id: RosterImportRowId;
  importId: RosterImportId;
  rowNumber: number;
  category: RosterPreviewCategory;
  personId: PersonId | null;
  proposed: Readonly<Record<string, unknown>>;
  issues: readonly RosterImportRowIssue[];
}

type RosterImportStatus =
  | "uploaded"
  | "validated"
  | "preview_ready"
  | "applied"
  | "failed"
  | "discarded";

interface RosterImport {
  id: RosterImportId;
  workspaceId: WorkspaceId;
  schoolId: SchoolId;
  status: RosterImportStatus;
  uploadedAt: UtcDateTime;
  previewHash: string | null;
  baseDirectoryRevision: DirectoryRevision | null;
  appliedAt: UtcDateTime | null;
}

interface RosterImportPreview {
  import: RosterImport;
  rows: readonly RosterImportRow[];
  previewHash: string;
  baseDirectoryRevision: DirectoryRevision;
}

interface RosterImportApplyRequest {
  importId: RosterImportId;
  previewHash: string;
  baseDirectoryRevision: DirectoryRevision;
}
```

Rules:

- `previewHash` is lowercase hex SHA-256 of a canonical preview payload defined
  by the later service slice; this package validates format only
  (`/^[0-9a-f]{64}$/`).
- Apply requests require both `previewHash` and `baseDirectoryRevision`.
- Stale-preview / stale-revision conflict handling is a service concern; the
  domain package validates structural presence and types.

## 9. Validation and conflict detection

### 9.1 Validation result shape

```ts
interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
}

type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: readonly ValidationIssue[] };
```

Validators never throw for ordinary invalid input. They return `{ ok: false }`.

### 9.2 Required validators

| Function | Checks |
|---|---|
| `parsePersonId` / other ID parsers | non-empty branded IDs |
| `parseIsoDate` | `YYYY-MM-DD` |
| `parseUtcDateTime` | RFC 3339 UTC `Z` |
| `parseDirectoryRevision` | safe integer ≥ 0 |
| `validatePerson` | displayName non-empty, status |
| `validateWorkspace` | kind, name |
| `validateAcademicYear` | `startDate <= endDate`, status |
| `validateEnrollment` | date order, status/`endDate` consistency, attendance optional |
| `validateStaffAssignment` | date order, role, status |
| `validateRoleAssignment` | discriminated scope/role, active ⇒ `endedAt === null` |
| `validateRosterImportApplyRequest` | ids, previewHash format, revision |
| `parseCapability` | closed union membership |

### 9.3 Pure conflict detectors

These functions inspect in-memory collections only:

```ts
function findActiveAccountLinkConflicts(
  links: readonly PersonAccountLink[],
): readonly ValidationIssue[];

function findOverlappingEnrollmentConflicts(
  enrollments: readonly Enrollment[],
): readonly ValidationIssue[];

function findAttendanceNumberConflicts(
  enrollments: readonly Enrollment[],
): readonly ValidationIssue[];
```

Overlap rule for date ranges `[start, end]` where `end === null` means open:

- Two ranges overlap unless one ends strictly before the other starts.
- Attendance uniqueness applies only to overlapping `status === "active"`
  enrollments that share `classGroupId` and a non-null attendance number.

School-on-non-school-workspace check:

```ts
function assertSchoolWorkspaceKind(
  workspace: Workspace,
  school: School,
): ValidationResult<true>;
```

## 10. Deferred Person ID strategy (record only)

Approved migration decision (not implemented in this package):

- `user_accounts.id` retains legacy `users.id`.
- `people.id` is derived deterministically from a fixed namespace and the
  legacy user ID.
- Algorithm, namespace UUID, canonical input encoding, and golden vectors are
  defined in the later Workspace/Person schema + backfill design.
- This package must not invent a temporary Person ID generator that later
  migrations would have to reconcile.

## 11. Testing requirements

Focused Vitest suites must prove:

1. Every validator accepts valid fixtures and rejects malformed IDs, dates,
   statuses, and scope/role mismatches.
2. Capability union parsing rejects unknown strings.
3. Full role × capability matrix matches §7.2.
4. `evaluateAccess` denies by default with empty assignments.
5. Exact-scope matching: workspace A assignment does not grant workspace B.
6. Ended assignments never grant.
7. `StaffAssignment` / `Enrollment` facts cannot be smuggled into evaluation.
8. Explicit project `host` grants project capabilities only.
9. Active account-link uniqueness conflicts are detected.
10. Overlapping enrollment and attendance-number conflicts are detected;
    non-overlapping history is allowed.
11. Roster apply request validation requires hash + revision.
12. Package has zero runtime dependency on SQLite / Hono / React.

## 12. Acceptance criteria

- `@blocksync/workspace-directory` builds, typechecks, and passes its Vitest
  suite in isolation.
- Public surface matches §§5–9 with no SQLite types.
- Teacher/student labels never satisfy system capabilities without an explicit
  system `RoleAssignment`.
- Student + explicit project host role satisfies project host capabilities and
  not roster/system capabilities.
- Attendance number may be null; uniqueness holds only for overlapping active
  enrollments in the same class.
- Roadmap Phase 1 Task 1 checklist items for domain contracts are satisfied.
- No migration, repository, API, or UI files are introduced in this slice.

## 13. Stop conditions

- Package imports `better-sqlite3`, Hono, React, or project-store-sqlite.
- Capability union is left open-ended (`string`) or silently accepts unknown
  values.
- Evaluator inherits parent scopes implicitly.
- Enrollment/StaffAssignment automatically grant capabilities.
- Deterministic Person ID algorithm is invented here without a frozen
  namespace/golden-vector design.
- Target schema DDL or legacy backfill is mixed into this package.

## 14. Resolved decisions (this brainstorming)

1. Domain contracts precede SQLite target schema.
2. Capability model is a closed R1 operation-level union; unknown values deny.
3. Role assignment subject is `UserAccount`.
4. Models include history rows for links, memberships, enrollments, staff
   assignments, and role assignments.
5. Evaluator uses exact-scope match; no implicit Workspace→School→Class→Project
   inheritance inside the domain package.
6. Validation returns structured `ValidationResult` (no throw-for-invalid-input).
7. RosterImport / Row / preview / apply request shapes are included now.
8. Person ID deterministic generation remains deferred to the migration design.

## 15. Follow-on slices

1. TDD implementation of this package (detailed plan after written-spec GO).
2. Workspace/Person target schema migration design using these contracts.
3. Legacy organization/user backfill with backup gate.
4. Repository ports/adapters, directory services, auth cutover, APIs, UI per
   the parent roadmap.
