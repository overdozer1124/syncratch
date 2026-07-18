# R1 Directory Attendance Uniqueness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add minimal enrollment read/create methods to `directoryRepo`, with explicit workspace CAS and transactional active attendance-number uniqueness.

**Architecture:** Extend the existing workspace-directory port with `getEnrollment` and `createEnrollment`. The SQLite adapter validates the enrollment, proves that its class belongs to the caller-provided workspace, bumps that workspace's directory revision, and inserts through the existing SQLite constraint mapper so the partial UNIQUE index returns `DIRECTORY_CONFLICT`.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, pnpm workspaces, existing R1 v3 school-roster schema.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-18-r1-directory-attendance-uniqueness-design.md`
- Existing index semantics govern this slice: active rows with the same non-null attendance number in one class conflict even when their date ranges do not overlap.
- `attendanceNumber: null` remains outside the partial UNIQUE index and may be used by multiple active rows.
- Every create is CAS-gated by caller-provided `workspaceId` + `expectedRevision`.
- A missing class or a class owned by another workspace throws `DIRECTORY_NOT_FOUND` before revision mutation.
- SQLite UNIQUE / PRIMARY KEY violations remain `DIRECTORY_CONFLICT`; FK remains `DIRECTORY_NOT_FOUND`; other constraints remain `DIRECTORY_INVALID`.
- Do not call or change `findAttendanceNumberConflicts` in this slice.
- Do not add update/end enrollment, hierarchy write APIs, claim, System Owner, transfer, audit, API, or UI behavior.
- Synchronous transactions only; no `await` inside `withTransaction`.
- Do not touch or stage `docs/ai-platform/`.
- Keep `workspace-directory` free of SQLite / hono / react / `project-store-sqlite` imports.

---

## File Map

| Path | Responsibility |
|---|---|
| `packages/workspace-directory/src/repository.ts` | Enrollment port methods |
| `packages/workspace-directory/src/repository.test.ts` | Port type smoke |
| `packages/project-store-sqlite/src/directory-repository.ts` | Enrollment row mapping, tenant check, CAS, insert |
| `packages/project-store-sqlite/src/directory-repository.contract.test.ts` | Success, uniqueness, null, BOLA, and stale-CAS contracts |
| `docs/superpowers/specs/2026-07-18-r1-directory-attendance-uniqueness-design.md` | Approved design status |
| `docs/superpowers/specs/2026-07-18-r1-workspace-directory-repositories-design.md` | Port/error-contract follow-up note |
| `docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md` | Thin-slice roadmap status |
| `docs/CURSOR_CODEX_HANDOFF.md` | Review handoff |

---

### Task 1: Enrollment port surface

**Files:**
- Modify: `packages/workspace-directory/src/repository.test.ts`
- Modify: `packages/workspace-directory/src/repository.ts`

**Interfaces:**
- Consumes: existing `Enrollment` model from `./models.js`
- Produces:

```ts
getEnrollment(enrollmentId: string): Enrollment | null;

createEnrollment(input: {
  workspaceId: string;
  expectedRevision: number;
  updatedAt: string;
  enrollment: Enrollment;
}): {revision: number; enrollment: Enrollment};
```

- [ ] **Step 1: Write the failing port type test**

Add `Enrollment` to the type imports and append:

```ts
it("types enrollment reads and CAS-gated creation", () => {
  type EnrollmentPort = Pick<
    WorkspaceDirectoryRepositoryTx,
    "getEnrollment" | "createEnrollment"
  >;

  const enrollment = {} as Enrollment;
  const _typeCheck: EnrollmentPort = {
    getEnrollment: () => null,
    createEnrollment: input => ({
      revision: input.expectedRevision + 1,
      enrollment: input.enrollment,
    }),
  };

  expect(_typeCheck.getEnrollment("enrollment-1")).toBeNull();
  expect(
    _typeCheck.createEnrollment({
      workspaceId: "workspace-1",
      expectedRevision: 0,
      updatedAt: "2026-07-18T00:00:00.000Z",
      enrollment,
    }).revision,
  ).toBe(1);
});
```

- [ ] **Step 2: Run the focused test to verify RED**

Run:

```bash
pnpm --filter @blocksync/workspace-directory typecheck
```

Expected: FAIL with TypeScript errors because `getEnrollment` and
`createEnrollment` do not exist on `WorkspaceDirectoryRepositoryTx`.

- [ ] **Step 3: Add the port methods**

Import `Enrollment` from `./models.js`, add `getEnrollment` with the other reads, and add `createEnrollment` after membership writes using the exact signatures above.

- [ ] **Step 4: Verify the port package**

Run:

```bash
pnpm --filter @blocksync/workspace-directory test
pnpm --filter @blocksync/workspace-directory typecheck
```

Expected: all tests pass and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/workspace-directory/src/repository.ts \
  packages/workspace-directory/src/repository.test.ts
git commit -m "feat(directory): add enrollment repository port"
```

---

### Task 2: Failing SQLite enrollment contracts

**Files:**
- Modify: `packages/project-store-sqlite/src/directory-repository.contract.test.ts`
- Modify: `packages/project-store-sqlite/src/directory-repository.ts`

**Interfaces:**
- Consumes: Task 1 port methods
- Produces: a compiling adapter stub plus RED behavior contracts

- [ ] **Step 1: Add a deterministic enrollment fixture helper**

Inside the existing writes `describe`, add a helper which opens a fresh migrated file DB, registers its close callback, and seeds exact hierarchy rows:

```ts
function openEnrollmentDb(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const db = openMigratedDb(join(dir, "db.sqlite"));
  closers.push(() => db.close());
  db.exec(`
    INSERT INTO workspaces(id, kind, name, created_at, updated_at)
    VALUES
      ('ws-school','school','School','2026-07-18T00:00:00.000Z','2026-07-18T00:00:00.000Z'),
      ('ws-foreign','school','Foreign','2026-07-18T00:00:00.000Z','2026-07-18T00:00:00.000Z');
    INSERT INTO workspace_directory_revisions(workspace_id, revision, updated_at)
    VALUES
      ('ws-school',0,'2026-07-18T00:00:00.000Z'),
      ('ws-foreign',0,'2026-07-18T00:00:00.000Z');
    INSERT INTO schools(id, workspace_id, name, created_at, updated_at)
    VALUES
      ('school-1','ws-school','School','2026-07-18T00:00:00.000Z','2026-07-18T00:00:00.000Z'),
      ('school-foreign','ws-foreign','Foreign','2026-07-18T00:00:00.000Z','2026-07-18T00:00:00.000Z');
    INSERT INTO academic_years(id, school_id, label, start_date, end_date, status)
    VALUES
      ('year-1','school-1','2026','2026-04-01','2027-03-31','active'),
      ('year-foreign','school-foreign','2026','2026-04-01','2027-03-31','active');
    INSERT INTO grades(id, academic_year_id, code, display_label, sort_order)
    VALUES
      ('grade-1','year-1','1','Grade 1',1),
      ('grade-foreign','year-foreign','1','Grade 1',1);
    INSERT INTO class_groups(id, academic_year_id, grade_id, label)
    VALUES
      ('class-1','year-1','grade-1','Class 1'),
      ('class-foreign','year-foreign','grade-foreign','Foreign Class');
    INSERT INTO people(id, display_name, status, created_at, updated_at)
    VALUES
      ('person-1','Person 1','active','2026-07-18T00:00:00.000Z','2026-07-18T00:00:00.000Z'),
      ('person-2','Person 2','active','2026-07-18T00:00:00.000Z','2026-07-18T00:00:00.000Z'),
      ('person-3','Person 3','active','2026-07-18T00:00:00.000Z','2026-07-18T00:00:00.000Z');
  `);
  return {
    db,
    repo: createSqliteWorkspaceDirectoryRepository(db),
    workspaceId: "ws-school",
    foreignWorkspaceId: "ws-foreign",
  };
}
```

- [ ] **Step 2: Add five behavior contracts**

Use active enrollment objects with `endDate: null`:

1. Create `enrollment-1` for `person-1`, `class-1`, attendance `"12"`; assert revision 1 and `getEnrollment` round-trip.
2. Create `enrollment-1`, then create `enrollment-2` for `person-2` with the same class/attendance; assert `DIRECTORY_CONFLICT`, revision remains 1, second row is absent.
3. Create two enrollments for different people with `attendanceNumber: null`; assert both succeed and revision reaches 2.
4. Try `class-foreign` while passing `workspaceId: "ws-school"`; assert `DIRECTORY_NOT_FOUND`, both workspace revisions remain 0, row absent.
5. Try a valid enrollment with stale `expectedRevision: -1`; assert `DIRECTORY_REVISION_CONFLICT`, revision remains 0, row absent.
6. Try a valid enrollment with `updatedAt: "not-a-utc-date-time"`; assert `DIRECTORY_INVALID`, revision remains 0, row absent.

Use explicit `updatedAt` values such as `2026-07-18T01:00:00.000Z` and advance them for sequential writes.

- [ ] **Step 3: Add compiling adapter stubs**

Add `Enrollment` / `validateEnrollment` imports as needed. Add `getEnrollment` returning `null` and `createEnrollment` throwing:

```ts
throw new DirectoryError("DIRECTORY_INVALID", "enrollment write not implemented");
```

- [ ] **Step 4: Run the focused contracts to verify RED**

Run:

```bash
pnpm --filter @blocksync/project-store-sqlite test -- src/directory-repository.contract.test.ts
```

Expected: the six new cases fail on the stubs; pre-existing cases stay green.

- [ ] **Step 5: Commit the RED contracts and stubs**

```bash
git add packages/project-store-sqlite/src/directory-repository.ts \
  packages/project-store-sqlite/src/directory-repository.contract.test.ts
git commit -m "test(store): add failing enrollment uniqueness contracts"
```

---

### Task 3: Implement enrollment reads and CAS-gated create

**Files:**
- Modify: `packages/project-store-sqlite/src/directory-repository.ts`
- Modify: `packages/project-store-sqlite/src/directory-repository.contract.test.ts` (keep green)

**Interfaces:**
- Consumes: Task 1 port and Task 2 contracts
- Produces: working `getEnrollment` / `createEnrollment`

- [ ] **Step 1: Prepare enrollment statements**

Add:

```ts
const getEnrollment = db.prepare(`
  SELECT id, person_id AS personId, class_group_id AS classGroupId,
         status, start_date AS startDate, end_date AS endDate,
         attendance_number AS attendanceNumber
  FROM enrollments
  WHERE id = ?
`);

const getClassWorkspace = db.prepare(`
  SELECT s.workspace_id AS workspaceId
  FROM class_groups cg
  INNER JOIN academic_years ay ON ay.id = cg.academic_year_id
  INNER JOIN schools s ON s.id = ay.school_id
  WHERE cg.id = ?
`);

const insertEnrollmentStmt = db.prepare(`
  INSERT INTO enrollments(
    id, person_id, class_group_id, status,
    start_date, end_date, attendance_number
  ) VALUES (
    @id, @personId, @classGroupId, @status,
    @startDate, @endDate, @attendanceNumber
  )
`);
```

- [ ] **Step 2: Implement `getEnrollment`**

Map the row to `Enrollment`, return `null` for no row, and use `validated(row, validateEnrollment)` for fail-closed corrupt-row behavior.

- [ ] **Step 3: Implement `createEnrollment` in the required order**

Import `parseUtcDateTime` from `@blocksync/workspace-directory`. Validate the
separate revision timestamp before any database read or write.

```ts
createEnrollment({
  workspaceId,
  expectedRevision,
  updatedAt,
  enrollment,
}) {
  const validEnrollment = validated(enrollment, validateEnrollment);
  const parsedUpdatedAt = parseUtcDateTime(updatedAt);
  if (!parsedUpdatedAt.ok) {
    throw new DirectoryError(
      "DIRECTORY_INVALID",
      parsedUpdatedAt.issues.map(issue => issue.message).join("; "),
    );
  }
  const classOwner = getClassWorkspace.get(
    validEnrollment.classGroupId,
  ) as {workspaceId: string} | undefined;
  if (classOwner === undefined || classOwner.workspaceId !== workspaceId) {
    throw new DirectoryError(
      "DIRECTORY_NOT_FOUND",
      `class ${validEnrollment.classGroupId} not found in workspace ${workspaceId}`,
    );
  }
  const revision = assertAndBumpRevision(
    workspaceId,
    expectedRevision,
    parsedUpdatedAt.value,
  );
  runMappedConstraint(() => insertEnrollmentStmt.run(validEnrollment));
  return {revision, enrollment: validEnrollment};
}
```

Do not add a preflight attendance query and do not call `findAttendanceNumberConflicts`; the existing partial UNIQUE index is the concurrency-safe authority for this slice.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @blocksync/project-store-sqlite test -- src/directory-repository.contract.test.ts
pnpm --filter @blocksync/project-store-sqlite typecheck
pnpm --filter @blocksync/workspace-directory test
pnpm --filter @blocksync/workspace-directory typecheck
```

Expected: all pass. Specifically, duplicate attendance maps to `DIRECTORY_CONFLICT`, tenant mismatch maps to `DIRECTORY_NOT_FOUND`, and failed writes leave revisions unchanged by transaction rollback.

- [ ] **Step 5: Commit**

```bash
git add packages/project-store-sqlite/src/directory-repository.ts \
  packages/project-store-sqlite/src/directory-repository.contract.test.ts
git commit -m "feat(store): create enrollment with attendance uniqueness"
```

---

### Task 4: Documentation, handoff, and final gates

**Files:**
- Modify: `docs/superpowers/specs/2026-07-18-r1-directory-attendance-uniqueness-design.md`
- Modify: `docs/superpowers/specs/2026-07-18-r1-workspace-directory-repositories-design.md`
- Modify: `docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md`
- Modify: `docs/CURSOR_CODEX_HANDOFF.md`

**Interfaces:**
- Consumes: implemented enrollment commit from Task 3
- Produces: approved design and review-ready handoff

- [ ] **Step 1: Approve and cross-reference the design**

Set attendance design status to `Approved design`. In the predecessor repository design, document the new `getEnrollment` / `createEnrollment` thin surface and that active attendance uniqueness follows `ux_enroll_active_attendance`.

- [ ] **Step 2: Update roadmap without overstating completion**

Add a thin-slice note under Phase 3 Task 4:

```md
**Thin slice (2026-07-18 attendance):** `getEnrollment` / CAS-gated
`createEnrollment` landed; active non-null attendance uniqueness follows the
existing partial UNIQUE index. Update/end enrollment, overlap-only service
rules, claim, System Owner transfer, and audit remain open.
```

Keep the broad attendance/Task 5 checkbox unchecked because update/end and service lifecycle are still missing.

- [ ] **Step 3: Update handoff**

Update the current-state block and append a timestamped log:

- State: `READY_FOR_CODEX_REVIEW`
- Current task: Directory attendance uniqueness thin slice
- Implementation SHA: Task 3 implementation commit, not the docs commit
- Evidence: focused contract count, both package typechecks, workspace-directory tests
- Remaining: update/end enrollment, overlap service rule, claim, System Owner transfer, audit

- [ ] **Step 4: Run final gates**

```bash
pnpm --filter @blocksync/workspace-directory test
pnpm --filter @blocksync/workspace-directory typecheck
pnpm --filter @blocksync/project-store-sqlite test
pnpm --filter @blocksync/project-store-sqlite typecheck
pnpm r1:persist:test
git diff --check
```

Expected: all commands exit 0. Existing server tests may emit their established auth rejection diagnostics; no new warnings are acceptable.

- [ ] **Step 5: Commit**

```bash
git add \
  docs/superpowers/specs/2026-07-18-r1-directory-attendance-uniqueness-design.md \
  docs/superpowers/specs/2026-07-18-r1-workspace-directory-repositories-design.md \
  docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md \
  docs/CURSOR_CODEX_HANDOFF.md
git commit -m "docs(r1): record attendance uniqueness slice"
```

---

## Review Gates

After each task, perform task-scoped spec + quality review. After Task 4:

1. Build a whole-branch diff from the plan base to HEAD.
2. Confirm no changes under `docs/ai-platform/`.
3. Verify class ownership is checked before CAS.
4. Verify uniqueness relies on the existing partial UNIQUE index inside the same transaction.
5. Confirm the broad roadmap checkbox remains unchecked.
6. Run a final whole-branch code review and fix every Critical/Important finding before merge.

## Spec Coverage

| Design requirement | Task |
|---|---|
| Port methods | 1 |
| Success + read round-trip | 2–3 |
| Attendance UNIQUE → conflict | 2–3 |
| Null attendance allowed | 2–3 |
| Cross-workspace class hiding | 2–3 |
| CAS rollback | 2–3 |
| Non-goals / no domain overlap helper | Global + review |
| Approved docs / handoff | 4 |
