# R1 Workspace Directory Domain Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a pure `@blocksync/workspace-directory` package that freezes Person/Workspace/roster models, closed operation-level capabilities, deny-by-default evaluation, validation results, and conflict detectors with no SQLite or Hono dependencies.

**Architecture:** Mirror `@blocksync/project-schema` package layout (vitest + tsc, `exports: { ".": "./src/index.ts" }`). Split modules by responsibility (`ids`, `models`, `access`, `roster-import`, `validation`, `conflicts`) and re-export only the public surface from `index.ts`. Every behavior is covered by focused Vitest contracts before production code.

**Tech Stack:** TypeScript, pnpm, Vitest, Node.js ≥24. No runtime dependencies beyond the TypeScript standard library.

## Global Constraints

- Implement only pure domain contracts. Do not create SQLite tables, migrations, repositories, Hono routes, UI, or auth cutover.
- Do not implement deterministic Person ID generation, namespace UUID, or golden vectors.
- Do not import `better-sqlite3`, Hono, React, or `@blocksync/project-store-sqlite`.
- Capability values are a closed union; unknown strings must fail validation and never grant access.
- `evaluateAccess` uses exact-scope matching only; no implicit parent-scope inheritance.
- Enrollment and StaffAssignment facts never produce capabilities.
- Role assignment subjects are `UserAccountId` only.
- Validators return `ValidationResult<T>`; they must not throw for ordinary invalid input.
- Do not touch or stage `docs/ai-platform/`.
- Preserve Migration Ledger freeze at `9b940f35b0b809daf9fa6d7e567da9d8565c0c08`; do not alter baseline fingerprints or committed fixtures.

---

## File Map

| Path | Responsibility |
|---|---|
| `packages/workspace-directory/package.json` | Package metadata and scripts |
| `packages/workspace-directory/tsconfig.json` | Extends repo base tsconfig |
| `packages/workspace-directory/vitest.config.ts` | Node vitest config |
| `packages/workspace-directory/src/ids.ts` | Branded IDs and parsers |
| `packages/workspace-directory/src/validation.ts` | `ValidationIssue` / `ValidationResult` helpers |
| `packages/workspace-directory/src/models.ts` | Entity interfaces and model validators |
| `packages/workspace-directory/src/access.ts` | Capability union, role templates, evaluator |
| `packages/workspace-directory/src/conflicts.ts` | Pure conflict detectors |
| `packages/workspace-directory/src/roster-import.ts` | Roster import/preview/apply contracts |
| `packages/workspace-directory/src/index.ts` | Public exports |
| `packages/workspace-directory/src/*.test.ts` | Focused contract tests |
| `docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md` | Mark Phase 1 Task 1 domain checklist progress |

---

### Task 1: Scaffold package and primitive validators

**Files:**
- Create: `packages/workspace-directory/package.json`
- Create: `packages/workspace-directory/tsconfig.json`
- Create: `packages/workspace-directory/vitest.config.ts`
- Create: `packages/workspace-directory/src/validation.ts`
- Create: `packages/workspace-directory/src/ids.ts`
- Create: `packages/workspace-directory/src/ids.test.ts`
- Create: `packages/workspace-directory/src/index.ts`

**Interfaces:**
- Consumes: none
- Produces:

```ts
export interface ValidationIssue {
  code: string;
  message: string;
  path?: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: readonly ValidationIssue[] };

export type PersonId = string & { readonly __brand: "PersonId" };
export type UserAccountId = string & { readonly __brand: "UserAccountId" };
export type WorkspaceId = string & { readonly __brand: "WorkspaceId" };
export type SchoolId = string & { readonly __brand: "SchoolId" };
export type AcademicYearId = string & { readonly __brand: "AcademicYearId" };
export type GradeId = string & { readonly __brand: "GradeId" };
export type ClassGroupId = string & { readonly __brand: "ClassGroupId" };
export type EnrollmentId = string & { readonly __brand: "EnrollmentId" };
export type StaffAssignmentId = string & { readonly __brand: "StaffAssignmentId" };
export type RoleAssignmentId = string & { readonly __brand: "RoleAssignmentId" };
export type RosterImportId = string & { readonly __brand: "RosterImportId" };
export type RosterImportRowId = string & { readonly __brand: "RosterImportRowId" };
export type AuditEventId = string & { readonly __brand: "AuditEventId" };
export type PersonAccountLinkId = string & { readonly __brand: "PersonAccountLinkId" };
export type WorkspaceMembershipId = string & { readonly __brand: "WorkspaceMembershipId" };

export type IsoDate = string & { readonly __brand: "IsoDate" };
export type UtcDateTime = string & { readonly __brand: "UtcDateTime" };
export type DirectoryRevision = number & { readonly __brand: "DirectoryRevision" };

export function issue(code: string, message: string, path?: string): ValidationIssue;
export function ok<T>(value: T): ValidationResult<T>;
export function fail(issues: readonly ValidationIssue[]): ValidationResult<never>;

export function parsePersonId(value: string): ValidationResult<PersonId>;
export function parseUserAccountId(value: string): ValidationResult<UserAccountId>;
export function parseWorkspaceId(value: string): ValidationResult<WorkspaceId>;
export function parseSchoolId(value: string): ValidationResult<SchoolId>;
export function parseAcademicYearId(value: string): ValidationResult<AcademicYearId>;
export function parseGradeId(value: string): ValidationResult<GradeId>;
export function parseClassGroupId(value: string): ValidationResult<ClassGroupId>;
export function parseEnrollmentId(value: string): ValidationResult<EnrollmentId>;
export function parseStaffAssignmentId(value: string): ValidationResult<StaffAssignmentId>;
export function parseRoleAssignmentId(value: string): ValidationResult<RoleAssignmentId>;
export function parseRosterImportId(value: string): ValidationResult<RosterImportId>;
export function parseRosterImportRowId(value: string): ValidationResult<RosterImportRowId>;
export function parseAuditEventId(value: string): ValidationResult<AuditEventId>;
export function parsePersonAccountLinkId(value: string): ValidationResult<PersonAccountLinkId>;
export function parseWorkspaceMembershipId(value: string): ValidationResult<WorkspaceMembershipId>;
export function parseIsoDate(value: string): ValidationResult<IsoDate>;
export function parseUtcDateTime(value: string): ValidationResult<UtcDateTime>;
export function parseDirectoryRevision(value: number): ValidationResult<DirectoryRevision>;
```

- [ ] **Step 1: Write the failing primitive tests**

Create `src/ids.test.ts`:

```ts
import {describe, expect, it} from "vitest";
import {
  parseDirectoryRevision,
  parseIsoDate,
  parsePersonId,
  parseUtcDateTime,
  parseWorkspaceId,
} from "./ids.js";

describe("workspace-directory ids", () => {
  it("accepts non-empty trimmed ids", () => {
    expect(parsePersonId("person-1")).toEqual({
      ok: true,
      value: "person-1",
    });
    expect(parseWorkspaceId("ws-1")).toEqual({ok: true, value: "ws-1"});
  });

  it("rejects empty and whitespace-only ids without throwing", () => {
    expect(parsePersonId("")).toMatchObject({ok: false});
    expect(parsePersonId("   ")).toMatchObject({ok: false});
  });

  it("parses strict IsoDate and UtcDateTime", () => {
    expect(parseIsoDate("2026-07-17")).toEqual({
      ok: true,
      value: "2026-07-17",
    });
    expect(parseIsoDate("2026-7-17")).toMatchObject({ok: false});
    expect(parseUtcDateTime("2026-07-17T12:00:00.000Z")).toEqual({
      ok: true,
      value: "2026-07-17T12:00:00.000Z",
    });
    expect(parseUtcDateTime("2026-07-17T12:00:00+09:00")).toMatchObject({
      ok: false,
    });
  });

  it("parses non-negative safe integer directory revisions", () => {
    expect(parseDirectoryRevision(0)).toEqual({ok: true, value: 0});
    expect(parseDirectoryRevision(12)).toEqual({ok: true, value: 12});
    expect(parseDirectoryRevision(-1)).toMatchObject({ok: false});
    expect(parseDirectoryRevision(1.5)).toMatchObject({ok: false});
    expect(parseDirectoryRevision(Number.NaN)).toMatchObject({ok: false});
  });
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```text
pnpm --filter @blocksync/workspace-directory test -- src/ids.test.ts
```

Expected: FAIL because the package/module does not exist.

- [ ] **Step 3: Scaffold package and implement primitives**

`package.json`:

```json
{
  "name": "@blocksync/workspace-directory",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "description": "EXPERIMENTAL R1 workspace directory domain contracts. No SQLite or API stability.",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.8.3",
    "vitest": "^3.2.4"
  }
}
```

`tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "composite": false
  },
  "include": ["src/**/*"]
}
```

`vitest.config.ts`:

```ts
import {defineConfig} from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

Implement `validation.ts` helpers and `ids.ts` parsers:

- Trim IDs; reject if resulting string is empty.
- `IsoDate` regex: `/^\d{4}-\d{2}-\d{2}$/` plus `Date.parse(`${value}T00:00:00.000Z`)` finite check that round-trips the same calendar date.
- `UtcDateTime` regex: `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/`.
- `DirectoryRevision`: `Number.isSafeInteger(value) && value >= 0`.

`index.ts` re-exports the Task 1 surface.

- [ ] **Step 4: Run focused tests and typecheck**

```text
pnpm install
pnpm --filter @blocksync/workspace-directory test -- src/ids.test.ts
pnpm --filter @blocksync/workspace-directory typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/workspace-directory/package.json \
  packages/workspace-directory/tsconfig.json \
  packages/workspace-directory/vitest.config.ts \
  packages/workspace-directory/src/validation.ts \
  packages/workspace-directory/src/ids.ts \
  packages/workspace-directory/src/ids.test.ts \
  packages/workspace-directory/src/index.ts \
  pnpm-lock.yaml
git commit -m "feat(directory): add workspace directory id primitives"
```

---

### Task 2: Domain model validators

**Files:**
- Create: `packages/workspace-directory/src/models.ts`
- Create: `packages/workspace-directory/src/models.test.ts`
- Modify: `packages/workspace-directory/src/index.ts`

**Interfaces:**
- Consumes: branded IDs and `ValidationResult` from Task 1
- Produces: entity interfaces and `validate*` functions listed in design §6 and §9.2 for Person, Workspace, AcademicYear, Enrollment, StaffAssignment, RoleAssignment, PersonAccountLink, WorkspaceMembership, School, Grade, ClassGroup, AuditEvent

- [ ] **Step 1: Write failing model tests**

```ts
import {describe, expect, it} from "vitest";
import {
  parseClassGroupId,
  parseIsoDate,
  parsePersonId,
  parseRoleAssignmentId,
  parseUserAccountId,
  parseUtcDateTime,
  parseWorkspaceId,
} from "./ids.js";
import {
  validateEnrollment,
  validatePerson,
  validateRoleAssignment,
  validateWorkspace,
} from "./models.js";

const now = parseUtcDateTime("2026-07-17T12:00:00.000Z");
if (!now.ok) throw new Error("fixture");

describe("workspace-directory models", () => {
  it("validates person and workspace kinds", () => {
    const personId = parsePersonId("p1");
    const workspaceId = parseWorkspaceId("w1");
    if (!personId.ok || !workspaceId.ok) throw new Error("fixture");

    expect(
      validatePerson({
        id: personId.value,
        displayName: "Ada",
        status: "active",
        createdAt: now.value,
        updatedAt: now.value,
      }),
    ).toMatchObject({ok: true});

    expect(
      validatePerson({
        id: personId.value,
        displayName: " ",
        status: "active",
        createdAt: now.value,
        updatedAt: now.value,
      }),
    ).toMatchObject({ok: false});

    expect(
      validateWorkspace({
        id: workspaceId.value,
        kind: "school",
        name: "North",
        createdAt: now.value,
        updatedAt: now.value,
      }),
    ).toMatchObject({ok: true});
  });

  it("requires enrollment date order and active endDate null", () => {
    const personId = parsePersonId("p1");
    const classGroupId = parseClassGroupId("c1");
    const start = parseIsoDate("2026-04-01");
    const end = parseIsoDate("2026-03-01");
    if (!personId.ok || !classGroupId.ok || !start.ok || !end.ok) {
      throw new Error("fixture");
    }

    expect(
      validateEnrollment({
        id: parsePersonId("e1").ok
          ? (parsePersonId("e1") as never)
          : ("" as never),
        personId: personId.value,
        classGroupId: classGroupId.value,
        status: "active",
        startDate: start.value,
        endDate: null,
        attendanceNumber: null,
      }),
    );
  });

  it("rejects role/scope mismatches and active rows with endedAt", () => {
    const id = parseRoleAssignmentId("r1");
    const accountId = parseUserAccountId("a1");
    const workspaceId = parseWorkspaceId("w1");
    if (!id.ok || !accountId.ok || !workspaceId.ok) throw new Error("fixture");

    expect(
      validateRoleAssignment({
        id: id.value,
        accountId: accountId.value,
        scope: {kind: "workspace", workspaceId: workspaceId.value},
        role: "owner",
        status: "active",
        startedAt: now.value,
        endedAt: null,
      }),
    ).toMatchObject({ok: true});

    expect(
      validateRoleAssignment({
        id: id.value,
        accountId: accountId.value,
        scope: {kind: "system"},
        role: "owner",
        status: "active",
        startedAt: now.value,
        endedAt: now.value,
      }),
    ).toMatchObject({ok: false});
  });
});
```

Rewrite the enrollment fixture in the real test file to use `parseEnrollmentId` once that parser exists (Task 1 already adds it). Do not use the `parsePersonId("e1")` placeholder above in the committed test; it is only a sketch of the assertion shape. The committed test must:

```ts
const enrollmentId = parseEnrollmentId("e1");
// active + endDate null => ok
// active + endDate set => fail
// startDate > endDate => fail
```

- [ ] **Step 2: Verify RED**

```text
pnpm --filter @blocksync/workspace-directory test -- src/models.test.ts
```

Expected: FAIL because `models.js` is missing.

- [ ] **Step 3: Implement models**

Create `models.ts` with the interfaces and validators from the design doc §§6 and 9.2. Keep validators pure and free of I/O.

- [ ] **Step 4: GREEN + typecheck**

```text
pnpm --filter @blocksync/workspace-directory test -- src/models.test.ts
pnpm --filter @blocksync/workspace-directory typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/workspace-directory/src/models.ts \
  packages/workspace-directory/src/models.test.ts \
  packages/workspace-directory/src/index.ts
git commit -m "feat(directory): validate workspace roster models"
```

---

### Task 3: Closed capabilities and deny-by-default evaluator

**Files:**
- Create: `packages/workspace-directory/src/access.ts`
- Create: `packages/workspace-directory/src/access.test.ts`
- Modify: `packages/workspace-directory/src/index.ts`

**Interfaces:**
- Consumes: `RoleAssignment`, branded IDs, `UtcDateTime`
- Produces:

```ts
export type Capability =
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

export function parseCapability(value: string): ValidationResult<Capability>;
export function capabilitiesForRole(
  scopeKind: AccessScope["kind"],
  role: string,
): ReadonlySet<Capability>;
export function evaluateAccess(input: {
  assignments: readonly RoleAssignment[];
  accountId: UserAccountId;
  scope: AccessScope;
  capability: Capability;
  now: UtcDateTime;
}): boolean;
```

- [ ] **Step 1: Write failing access tests**

Cover at minimum:

1. `parseCapability("school.roster_claim.issue")` ok; unknown `"school.magic"` fails.
2. Table-driven checks for every role in design §7.2 (at least one capability that must be present and one that must be absent for operator/member/guest/student/viewer).
3. Empty assignments ⇒ deny.
4. Workspace A assignment does not grant Workspace B.
5. Ended assignment denies.
6. Explicit project `host` grants `project.host.manage` and denies `system.secrets.read` and `school.roster.manage`.
7. Passing an enrollment-like object is a TypeScript-level impossibility; runtime test constructs only `RoleAssignment` values and documents that facts are out of band.

- [ ] **Step 2: RED**

```text
pnpm --filter @blocksync/workspace-directory test -- src/access.test.ts
```

- [ ] **Step 3: Implement access.ts**

Hard-code role templates as `ReadonlyMap` / object literals. `evaluateAccess` follows design §7.3 steps 1–6 exactly.

- [ ] **Step 4: GREEN + typecheck**

```text
pnpm --filter @blocksync/workspace-directory test -- src/access.test.ts
pnpm --filter @blocksync/workspace-directory typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/workspace-directory/src/access.ts \
  packages/workspace-directory/src/access.test.ts \
  packages/workspace-directory/src/index.ts
git commit -m "feat(directory): add scoped capability evaluation"
```

---

### Task 4: Conflict detectors

**Files:**
- Create: `packages/workspace-directory/src/conflicts.ts`
- Create: `packages/workspace-directory/src/conflicts.test.ts`
- Modify: `packages/workspace-directory/src/index.ts`

**Interfaces:**
- Produces:

```ts
export function findActiveAccountLinkConflicts(
  links: readonly PersonAccountLink[],
): readonly ValidationIssue[];

export function findOverlappingEnrollmentConflicts(
  enrollments: readonly Enrollment[],
): readonly ValidationIssue[];

export function findAttendanceNumberConflicts(
  enrollments: readonly Enrollment[],
): readonly ValidationIssue[];

export function assertSchoolWorkspaceKind(
  workspace: Workspace,
  school: School,
): ValidationResult<true>;
```

- [ ] **Step 1: Write failing conflict tests**

```ts
it("detects two active links for one account", () => { /* ... */ });
it("allows historical unlinked rows for the same account", () => { /* ... */ });
it("detects overlapping active enrollments for the same person/class", () => { /* ... */ });
it("allows non-overlapping enrollment history", () => { /* ... */ });
it("detects duplicate attendance numbers only for overlapping active rows", () => { /* ... */ });
it("allows null attendance numbers", () => { /* ... */ });
it("rejects school records on non-school workspaces", () => { /* ... */ });
```

Date overlap: ranges `[start, end]` with `end === null` open-ended overlap unless one ends strictly before the other starts (`end < other.start`).

- [ ] **Step 2: RED**

```text
pnpm --filter @blocksync/workspace-directory test -- src/conflicts.test.ts
```

- [ ] **Step 3: Implement conflicts.ts**

- [ ] **Step 4: GREEN + typecheck**

```text
pnpm --filter @blocksync/workspace-directory test -- src/conflicts.test.ts
pnpm --filter @blocksync/workspace-directory typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/workspace-directory/src/conflicts.ts \
  packages/workspace-directory/src/conflicts.test.ts \
  packages/workspace-directory/src/index.ts
git commit -m "feat(directory): detect roster and link conflicts"
```

---

### Task 5: Roster import contracts and public surface freeze

**Files:**
- Create: `packages/workspace-directory/src/roster-import.ts`
- Create: `packages/workspace-directory/src/roster-import.test.ts`
- Create: `packages/workspace-directory/src/package-boundary.test.ts`
- Modify: `packages/workspace-directory/src/index.ts`
- Modify: `docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md`

**Interfaces:**
- Produces roster types and:

```ts
export function validateRosterImportApplyRequest(
  value: RosterImportApplyRequest,
): ValidationResult<RosterImportApplyRequest>;

export function parsePreviewHash(value: string): ValidationResult<string>;
```

`parsePreviewHash` accepts `/^[0-9a-f]{64}$/` only.

- [ ] **Step 1: Write failing roster and boundary tests**

Roster tests:

- valid apply request passes
- missing/invalid previewHash fails
- negative revision fails

Boundary test:

```ts
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";

describe("package boundary", () => {
  it("declares no runtime dependencies and no sqlite/hono/react imports", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    expect(pkg.dependencies ?? {}).toEqual({});

    const sources = [
      "ids.ts",
      "validation.ts",
      "models.ts",
      "access.ts",
      "conflicts.ts",
      "roster-import.ts",
      "index.ts",
    ];
    for (const file of sources) {
      const text = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(text).not.toMatch(/better-sqlite3|from ["']hono|from ["']react|project-store-sqlite/);
    }
  });
});
```

- [ ] **Step 2: RED**

```text
pnpm --filter @blocksync/workspace-directory test -- src/roster-import.test.ts src/package-boundary.test.ts
```

- [ ] **Step 3: Implement roster-import.ts and freeze index.ts exports**

`index.ts` must export only the public types/functions from Tasks 1–5. Do not export test helpers.

Update roadmap Phase 1 Task 1 checkboxes that this package satisfies:

- [x] Failing validator and capability matrix tests.
- [x] Implement pure types, validation and permission evaluation.
- [x] Export only domain contracts; no SQLite or Hono imports.

Leave the commit message line unchecked until Step 5 lands, then mark:

- [x] Commit: `feat(directory): workspace roster and scoped access contracts`.

- [ ] **Step 4: Full package gates**

```text
pnpm --filter @blocksync/workspace-directory test
pnpm --filter @blocksync/workspace-directory typecheck
pnpm --filter @blocksync/project-store-sqlite test
pnpm --filter @blocksync/session-service test
git diff --check
```

Also verify:

```text
- no docs/ai-platform staged
- no packages/project-store-sqlite/src/migrations changes
- no Workspace/Person SQL DDL introduced
- package import graph has no sqlite/hono/react
```

- [ ] **Step 5: Commit**

```bash
git add packages/workspace-directory/src/roster-import.ts \
  packages/workspace-directory/src/roster-import.test.ts \
  packages/workspace-directory/src/package-boundary.test.ts \
  packages/workspace-directory/src/index.ts \
  docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md
git commit -m "feat(directory): workspace roster and scoped access contracts"
```

---

## Plan Completion Gate

- `@blocksync/workspace-directory` typechecks and all package tests pass.
- Closed capability union rejects unknown values.
- Role × capability matrix matches the design.
- Exact-scope deny-by-default evaluation is proven.
- Conflict detectors cover active links, enrollment overlap, and attendance uniqueness.
- Roster apply request requires preview hash + directory revision.
- No SQLite/Hono/React/runtime deps; Migration Ledger and fixtures unchanged.
- Roadmap Phase 1 Task 1 domain checklist is marked complete.
- Shared ledger updated after implementation for review handoff.

After this plan is approved and implemented, create a separate design for the Workspace/Person target schema migration that consumes these contracts.
