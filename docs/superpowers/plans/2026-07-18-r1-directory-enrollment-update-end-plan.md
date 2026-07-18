# R1 Directory Enrollment Update/End Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add CAS-gated `updateEnrollment` and `endEnrollment` to `directoryRepo`, keeping active attendance uniqueness on the existing partial UNIQUE indexes and refusing updates to ended rows.

**Architecture:** Extend the workspace-directory port with patch-based update and dedicated end methods. The SQLite adapter parses `updatedAt`, loads the enrollment through the same workspace ownership join as `getEnrollment`, requires `status = 'active'`, validates the next row, bumps revision under `BEGIN IMMEDIATE`, and UPDATEs through `runMappedConstraint`.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, pnpm workspaces, existing R1 v3 school-roster schema.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-18-r1-directory-enrollment-update-end-design.md`
- Active-only: missing / foreign-tenant / already-ended → `DIRECTORY_NOT_FOUND`
- `updateEnrollment` never mutates `personId`, `classGroupId`, `status`, or `endDate`
- Empty patch or unknown patch keys → `DIRECTORY_INVALID`
- Uniqueness remains DB-owned (`ux_enroll_active_attendance`, `ux_enroll_active_person_class`); do not call `findAttendanceNumberConflicts`
- Every write is CAS-gated by `workspaceId` + `expectedRevision` + validated `updatedAt`
- UNIQUE/PK → `DIRECTORY_CONFLICT`; FK → `DIRECTORY_NOT_FOUND`; other constraints → `DIRECTORY_INVALID`
- Synchronous transactions only; no `await` inside `withTransaction`
- Do not add claim, System Owner, transfer, audit, hierarchy writes, API, or UI
- Do not touch or stage `docs/ai-platform/`
- Keep `workspace-directory` free of SQLite / hono / react / `project-store-sqlite` imports

---

## File Map

| Path | Responsibility |
|---|---|
| `packages/workspace-directory/src/repository.ts` | Port methods |
| `packages/workspace-directory/src/repository.test.ts` | Port type smoke |
| `packages/project-store-sqlite/src/directory-repository.ts` | Patch validation, active load, UPDATE |
| `packages/project-store-sqlite/src/directory-repository.contract.test.ts` | Update/end contracts |
| `docs/superpowers/specs/2026-07-18-r1-directory-enrollment-update-end-design.md` | Approved status |
| `docs/superpowers/specs/2026-07-18-r1-directory-attendance-uniqueness-design.md` | Follow-on note |
| `docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md` | Thin-slice roadmap note |
| `docs/CURSOR_CODEX_HANDOFF.md` | Review handoff |

---

### Task 1: Enrollment update/end port surface

**Files:**
- Modify: `packages/workspace-directory/src/repository.test.ts`
- Modify: `packages/workspace-directory/src/repository.ts`

**Interfaces:**
- Consumes: existing `Enrollment` model
- Produces:

```ts
updateEnrollment(input: {
  workspaceId: string;
  expectedRevision: number;
  updatedAt: string;
  enrollmentId: string;
  patch: {
    attendanceNumber?: string | null;
    startDate?: string;
  };
}): {revision: number; enrollment: Enrollment};

endEnrollment(input: {
  workspaceId: string;
  expectedRevision: number;
  updatedAt: string;
  enrollmentId: string;
  endDate: string;
}): {revision: number; enrollment: Enrollment};
```

- [ ] **Step 1: Write the failing port type test**

Append:

```ts
it("types enrollment update and end", () => {
  type EnrollmentMutations = Pick<
    WorkspaceDirectoryRepositoryTx,
    "updateEnrollment" | "endEnrollment"
  >;

  const enrollment = {} as Enrollment;
  const _typeCheck: EnrollmentMutations = {
    updateEnrollment: input => ({
      revision: input.expectedRevision + 1,
      enrollment,
    }),
    endEnrollment: input => ({
      revision: input.expectedRevision + 1,
      enrollment,
    }),
  };

  expect(
    _typeCheck.updateEnrollment({
      workspaceId: "workspace-1",
      expectedRevision: 0,
      updatedAt: "2026-07-18T00:00:00.000Z",
      enrollmentId: "enrollment-1",
      patch: {attendanceNumber: "12"},
    }).revision,
  ).toBe(1);
  expect(
    _typeCheck.endEnrollment({
      workspaceId: "workspace-1",
      expectedRevision: 1,
      updatedAt: "2026-07-18T01:00:00.000Z",
      enrollmentId: "enrollment-1",
      endDate: "2026-07-18",
    }).revision,
  ).toBe(2);
});
```

- [ ] **Step 2: Run typecheck to verify RED**

Run:

```bash
pnpm --filter @blocksync/workspace-directory typecheck
```

Expected: FAIL because the methods are missing on `WorkspaceDirectoryRepositoryTx`.

- [ ] **Step 3: Add the port methods**

Add both signatures after `createEnrollment` using the Interfaces block above exactly.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm --filter @blocksync/workspace-directory test
pnpm --filter @blocksync/workspace-directory typecheck
```

Expected: all tests pass; typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/workspace-directory/src/repository.ts \
  packages/workspace-directory/src/repository.test.ts
git commit -m "feat(directory): add enrollment update and end port"
```

---

### Task 2: Failing SQLite update/end contracts

**Files:**
- Modify: `packages/project-store-sqlite/src/directory-repository.contract.test.ts`
- Modify: `packages/project-store-sqlite/src/directory-repository.ts`

**Interfaces:**
- Consumes: Task 1 port methods; existing `openEnrollmentDb`
- Produces: compiling stubs + RED contracts

- [ ] **Step 1: Add stubs**

On the SQLite adapter, after `createEnrollment`, add:

```ts
updateEnrollment(_input) {
  throw new DirectoryError(
    "DIRECTORY_INVALID",
    "enrollment update not implemented",
  );
},
endEnrollment(_input) {
  throw new DirectoryError(
    "DIRECTORY_INVALID",
    "enrollment end not implemented",
  );
},
```

- [ ] **Step 2: Add behavior contracts**

Inside the writes `describe`, after the existing enrollment cases, add tests that use `openEnrollmentDb`. Create baseline enrollments with `createEnrollment` where needed. Cover:

1. Update attendance `"12"` → `"99"` → revision +1 and round-trip via `getEnrollment`
2. Two actives with `"12"` and `"13"`; update second to `"12"` → `DIRECTORY_CONFLICT`; second row and revision unchanged
3. End active → `status: "ended"`, `endDate: "2026-07-18"`; revision +1
4. After end, update and second end → `DIRECTORY_NOT_FOUND`; revision unchanged
5. Foreign `workspaceId` on update and on end → `DIRECTORY_NOT_FOUND`; both workspace revisions unchanged
6. Stale `expectedRevision: -1` on update → `DIRECTORY_REVISION_CONFLICT`
7. `updatedAt: "not-a-utc-date-time"` on update → `DIRECTORY_INVALID` with `message` stringContaining `"UtcDateTime"`
8. Empty patch `{}` and unknown key patch `{attendanceNumber: "1", classGroupId: "x"} as never` → `DIRECTORY_INVALID`

Use explicit `updatedAt` values such as `2026-07-18T02:00:00.000Z` and advance them for sequential writes.

Example shape for case 1:

```ts
it("updateEnrollment patches attendanceNumber and bumps revision", () => {
  const {repo, workspaceId} = openEnrollmentDb("dir-enroll-update-");
  const enrollment = {
    id: "enrollment-1",
    personId: "person-1",
    classGroupId: "class-1",
    status: "active",
    startDate: "2026-04-01",
    endDate: null,
    attendanceNumber: "12",
  } as Enrollment;

  repo.withTransaction(tx =>
    tx.createEnrollment({
      workspaceId,
      expectedRevision: 0,
      updatedAt: "2026-07-18T01:00:00.000Z",
      enrollment,
    }),
  );

  const result = repo.withTransaction(tx =>
    tx.updateEnrollment({
      workspaceId,
      expectedRevision: 1,
      updatedAt: "2026-07-18T02:00:00.000Z",
      enrollmentId: enrollment.id,
      patch: {attendanceNumber: "99"},
    }),
  );

  expect(result.revision).toBe(2);
  expect(result.enrollment.attendanceNumber).toBe("99");
  expect(
    repo.withTransaction(tx => tx.getEnrollment(workspaceId, enrollment.id)),
  ).toMatchObject({attendanceNumber: "99", status: "active", endDate: null});
});
```

- [ ] **Step 3: Run focused contracts to verify RED**

Run:

```bash
pnpm --filter @blocksync/project-store-sqlite test -- src/directory-repository.contract.test.ts
```

Expected: new update/end cases fail against stubs; strengthen invalid-`updatedAt` assertions so they do not vacuously pass on the stub message (require `UtcDateTime` in `message`, same pattern as create). Pre-existing cases stay green.

- [ ] **Step 4: Commit**

```bash
git add packages/project-store-sqlite/src/directory-repository.ts \
  packages/project-store-sqlite/src/directory-repository.contract.test.ts
git commit -m "test(store): add failing enrollment update and end contracts"
```

---

### Task 3: Implement update and end

**Files:**
- Modify: `packages/project-store-sqlite/src/directory-repository.ts`
- Modify: `packages/project-store-sqlite/src/directory-repository.contract.test.ts` (keep green)

**Interfaces:**
- Consumes: Task 1 port + Task 2 contracts
- Produces: working `updateEnrollment` / `endEnrollment`

- [ ] **Step 1: Add UPDATE statement**

```ts
const updateEnrollmentStmt = db.prepare(`
  UPDATE enrollments
  SET person_id = @personId,
      class_group_id = @classGroupId,
      status = @status,
      start_date = @startDate,
      end_date = @endDate,
      attendance_number = @attendanceNumber
  WHERE id = @id
`);
```

- [ ] **Step 2: Add patch guard helper**

```ts
const ENROLLMENT_UPDATE_KEYS = new Set([
  "attendanceNumber",
  "startDate",
]);

function normalizeEnrollmentPatch(
  patch: Record<string, unknown>,
): {attendanceNumber?: string | null; startDate?: string} {
  const keys = Object.keys(patch);
  if (keys.length === 0) {
    throw new DirectoryError("DIRECTORY_INVALID", "enrollment patch is empty");
  }
  for (const key of keys) {
    if (!ENROLLMENT_UPDATE_KEYS.has(key)) {
      throw new DirectoryError(
        "DIRECTORY_INVALID",
        `unknown enrollment patch field: ${key}`,
      );
    }
  }
  return patch as {attendanceNumber?: string | null; startDate?: string};
}
```

- [ ] **Step 3: Implement `updateEnrollment`**

```ts
updateEnrollment({
  workspaceId,
  expectedRevision,
  updatedAt,
  enrollmentId,
  patch,
}) {
  const parsedUpdatedAt = parseUtcDateTime(updatedAt);
  if (!parsedUpdatedAt.ok) {
    throw new DirectoryError(
      "DIRECTORY_INVALID",
      parsedUpdatedAt.issues.map(issue => issue.message).join("; "),
    );
  }
  const normalizedPatch = normalizeEnrollmentPatch(
    patch as Record<string, unknown>,
  );
  const existing = tx.getEnrollment(workspaceId, enrollmentId);
  if (existing === null || existing.status !== "active") {
    throw new DirectoryError(
      "DIRECTORY_NOT_FOUND",
      `enrollment ${enrollmentId} not found in workspace ${workspaceId}`,
    );
  }
  const next = validated(
    {
      ...existing,
      attendanceNumber:
        normalizedPatch.attendanceNumber !== undefined
          ? normalizedPatch.attendanceNumber
          : existing.attendanceNumber,
      startDate:
        normalizedPatch.startDate !== undefined
          ? (normalizedPatch.startDate as Enrollment["startDate"])
          : existing.startDate,
    },
    validateEnrollment,
  );
  const revision = assertAndBumpRevision(
    workspaceId,
    expectedRevision,
    parsedUpdatedAt.value,
  );
  runMappedConstraint(() => updateEnrollmentStmt.run(next));
  return {revision, enrollment: next};
},
```

Note: calling `tx.getEnrollment` is fine; it already applies the ownership join. The active check is explicit for existence hiding of ended rows.

- [ ] **Step 4: Implement `endEnrollment`**

```ts
endEnrollment({
  workspaceId,
  expectedRevision,
  updatedAt,
  enrollmentId,
  endDate,
}) {
  const parsedUpdatedAt = parseUtcDateTime(updatedAt);
  if (!parsedUpdatedAt.ok) {
    throw new DirectoryError(
      "DIRECTORY_INVALID",
      parsedUpdatedAt.issues.map(issue => issue.message).join("; "),
    );
  }
  const existing = tx.getEnrollment(workspaceId, enrollmentId);
  if (existing === null || existing.status !== "active") {
    throw new DirectoryError(
      "DIRECTORY_NOT_FOUND",
      `enrollment ${enrollmentId} not found in workspace ${workspaceId}`,
    );
  }
  const next = validated(
    {
      ...existing,
      status: "ended" as const,
      endDate: endDate as Enrollment["endDate"],
    },
    validateEnrollment,
  );
  const revision = assertAndBumpRevision(
    workspaceId,
    expectedRevision,
    parsedUpdatedAt.value,
  );
  runMappedConstraint(() => updateEnrollmentStmt.run(next));
  return {revision, enrollment: next};
},
```

- [ ] **Step 5: Verify GREEN**

Run:

```bash
pnpm --filter @blocksync/project-store-sqlite test -- src/directory-repository.contract.test.ts
pnpm --filter @blocksync/project-store-sqlite typecheck
pnpm --filter @blocksync/workspace-directory test
pnpm --filter @blocksync/workspace-directory typecheck
```

Expected: all pass. Duplicate attendance update maps to `DIRECTORY_CONFLICT` with revision rollback.

- [ ] **Step 6: Commit**

```bash
git add packages/project-store-sqlite/src/directory-repository.ts \
  packages/project-store-sqlite/src/directory-repository.contract.test.ts
git commit -m "feat(store): update and end enrollments with uniqueness"
```

---

### Task 4: Documentation, handoff, and final gates

**Files:**
- Modify: `docs/superpowers/specs/2026-07-18-r1-directory-enrollment-update-end-design.md`
- Modify: `docs/superpowers/specs/2026-07-18-r1-directory-attendance-uniqueness-design.md`
- Modify: `docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md`
- Modify: `docs/CURSOR_CODEX_HANDOFF.md`

**Interfaces:**
- Consumes: Task 3 implementation commit
- Produces: Approved design + review-ready handoff

- [ ] **Step 1: Approve and cross-link designs**

Set enrollment update/end design status to `Approved design`. In the attendance uniqueness design §7 Follow-ons, note that `updateEnrollment` / `endEnrollment` landed in this thin slice (active-only; class moves still end→create).

- [ ] **Step 2: Roadmap thin-slice note**

Under Phase 3 Task 4 attendance note, append:

```md
**Thin slice (2026-07-18 enrollment update/end):** CAS-gated
`updateEnrollment` (attendanceNumber/startDate patch) and `endEnrollment`
landed; active-only; ended rows hide as NOT_FOUND; UNIQUE remains DB-owned.
Class moves, overlap service rules, claim, System Owner transfer, and audit
remain open.
```

Keep broad Task 5 unchecked.

- [ ] **Step 3: Handoff**

Update current-state and append a timestamped log:

- State: `READY_FOR_CODEX_REVIEW`
- Implementation SHA: Task 3 feature commit (not docs tip)
- Evidence: contract count, both package typechecks, `pnpm r1:persist:test`
- Remaining: class-move orchestration, overlap service, claim, System Owner transfer, audit

- [ ] **Step 4: Final gates**

```bash
pnpm --filter @blocksync/workspace-directory test
pnpm --filter @blocksync/workspace-directory typecheck
pnpm --filter @blocksync/project-store-sqlite test
pnpm --filter @blocksync/project-store-sqlite typecheck
pnpm r1:persist:test
git diff --check
```

Expected: all exit 0.

- [ ] **Step 5: Commit**

```bash
git add \
  docs/superpowers/specs/2026-07-18-r1-directory-enrollment-update-end-design.md \
  docs/superpowers/specs/2026-07-18-r1-directory-attendance-uniqueness-design.md \
  docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md \
  docs/CURSOR_CODEX_HANDOFF.md
git commit -m "docs(r1): record enrollment update and end slice"
```

---

## Review Gates

After Task 4:

1. Spec compliance: active-only, empty/unknown patch rejection, UNIQUE via DB, no `findAttendanceNumberConflicts`
2. Package boundary: `workspace-directory` still SQLite-free
3. Handoff pins implementation SHA to Task 3 commit

---

## Spec coverage self-check

| Spec requirement | Task |
|---|---|
| Port `updateEnrollment` / `endEnrollment` | 1 |
| Empty / unknown patch → `DIRECTORY_INVALID` | 2, 3 |
| Active-only; ended → `DIRECTORY_NOT_FOUND` | 2, 3 |
| Duplicate attendance update → `DIRECTORY_CONFLICT` | 2, 3 |
| End success + re-end / post-end update | 2, 3 |
| Foreign workspace / stale CAS / bad `updatedAt` | 2, 3 |
| Docs + handoff + gates | 4 |
| No `findAttendanceNumberConflicts` | Global + 3 |
