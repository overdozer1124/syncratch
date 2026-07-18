# R1 Directory Constraint Error Mapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Map SQLite constraint codes in the workspace directory adapter so UNIQUE/PK → `DIRECTORY_CONFLICT`, FOREIGNKEY → `DIRECTORY_NOT_FOUND`, other constraints → `DIRECTORY_INVALID`.

**Architecture:** Replace `runOrConflict` / `isSqliteConstraintError` with `mapSqliteConstraint` + `runMappedConstraint` inside `directory-repository.ts`. No port signature changes. Clarify predecessor design §8 in the same change set.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, existing directory contract tests.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-18-r1-directory-constraint-error-mapping-design.md`
- Predecessor: `docs/superpowers/specs/2026-07-18-r1-workspace-directory-repositories-design.md`
- `DIRECTORY_CONFLICT` only for `SQLITE_CONSTRAINT_UNIQUE` and `SQLITE_CONSTRAINT_PRIMARYKEY`
- `DIRECTORY_NOT_FOUND` for `SQLITE_CONSTRAINT_FOREIGNKEY`
- `DIRECTORY_INVALID` for other `SQLITE_CONSTRAINT*` (CHECK, NOT NULL, …)
- Non-constraint errors rethrow unchanged
- Do not implement claim / attendance / last-owner / audit / API
- Do not touch or stage `docs/ai-platform/`
- Keep `workspace-directory` free of SQLite imports

---

## File Map

| Path | Responsibility |
|---|---|
| `packages/project-store-sqlite/src/directory-repository.ts` | Constraint mapping helpers + call sites |
| `packages/project-store-sqlite/src/directory-repository.contract.test.ts` | FK → NOT_FOUND contract |
| `docs/superpowers/specs/2026-07-18-r1-workspace-directory-repositories-design.md` | §8 wording clarification |
| `docs/CURSOR_CODEX_HANDOFF.md` | Slice status for this follow-up |

---

### Task 1: Failing FK contract + mapped constraint helpers

**Files:**
- Modify: `packages/project-store-sqlite/src/directory-repository.contract.test.ts`
- Modify: `packages/project-store-sqlite/src/directory-repository.ts`

**Interfaces:**
- Consumes: `createSqliteWorkspaceDirectoryRepository`, `DirectoryError`, existing write helpers
- Produces: `mapSqliteConstraint` / `runMappedConstraint` behavior; FK write → `DIRECTORY_NOT_FOUND`

- [ ] **Step 1: Write the failing FK test**

Append inside the existing writes `describe` (same helpers as other write tests — `openFixtureDb` / fixture open pattern already in the file):

```ts
  it("createMembership with a missing accountId yields DIRECTORY_NOT_FOUND and leaves revision unchanged", () => {
    const {db, workspaceId} = openFixtureDb("dir-fk-membership-");
    const repo = createSqliteWorkspaceDirectoryRepository(db);
    const before = repo.withTransaction(tx =>
      tx.getDirectoryRevision(workspaceId)!,
    );

    expect(() =>
      repo.withTransaction(tx =>
        tx.createMembership({
          expectedRevision: before.revision,
          membership: {
            id: "77777777-7777-4777-8777-777777777777",
            workspaceId,
            accountId: "missing-account-for-fk-test",
            role: "member",
            status: "active",
            startedAt: "2026-07-18T00:00:00.000Z",
            endedAt: null,
          } as never,
        }),
      ),
    ).toThrow(expect.objectContaining({code: "DIRECTORY_NOT_FOUND"}));

    expect(
      repo.withTransaction(tx => tx.getDirectoryRevision(workspaceId))
        ?.revision,
    ).toBe(before.revision);
    db.close();
  });
```

Notes:
- `accountId` must pass domain validation (non-empty string) but must not exist in `user_accounts`, so SQLite raises `SQLITE_CONSTRAINT_FOREIGNKEY`.
- Today this fails as `DIRECTORY_CONFLICT` (or wrong code) — that is the intended RED.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @blocksync/project-store-sqlite test -- src/directory-repository.contract.test.ts`

Expected: FAIL on the new case — assertion expects `DIRECTORY_NOT_FOUND` but adapter maps all constraints to `DIRECTORY_CONFLICT` (or equivalent mismatch). Existing UNIQUE conflict tests still pass.

- [ ] **Step 3: Replace constraint helpers**

In `directory-repository.ts`, remove `isSqliteConstraintError` and `runOrConflict`. Add:

```ts
  function mapSqliteConstraint(error: unknown): DirectoryError | null {
    if (
      typeof error !== "object" ||
      error === null ||
      typeof (error as {code?: unknown}).code !== "string"
    ) {
      return null;
    }
    const code = (error as {code: string}).code;
    if (!code.startsWith("SQLITE_CONSTRAINT")) {
      return null;
    }
    const message =
      error instanceof Error ? error.message : "directory constraint violated";
    switch (code) {
      case "SQLITE_CONSTRAINT_UNIQUE":
      case "SQLITE_CONSTRAINT_PRIMARYKEY":
        return new DirectoryError("DIRECTORY_CONFLICT", message);
      case "SQLITE_CONSTRAINT_FOREIGNKEY":
        return new DirectoryError("DIRECTORY_NOT_FOUND", message);
      default:
        return new DirectoryError("DIRECTORY_INVALID", message);
    }
  }

  function runMappedConstraint<T>(fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      const mapped = mapSqliteConstraint(error);
      if (mapped) {
        throw mapped;
      }
      throw error;
    }
  }
```

Replace every `runOrConflict(` call with `runMappedConstraint(`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @blocksync/project-store-sqlite test -- src/directory-repository.contract.test.ts`  
Expected: all PASS (including new FK case and existing UNIQUE → CONFLICT cases)

Run: `pnpm --filter @blocksync/project-store-sqlite typecheck`  
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add packages/project-store-sqlite/src/directory-repository.ts \
  packages/project-store-sqlite/src/directory-repository.contract.test.ts
git commit -m "$(cat <<'EOF'
fix(store): map directory SQLite constraints by error code

UNIQUE/PK become DIRECTORY_CONFLICT, FOREIGNKEY becomes
DIRECTORY_NOT_FOUND, and other SQLITE_CONSTRAINT* become
DIRECTORY_INVALID.
EOF
)"
```

---

### Task 2: Spec §8 clarification + handoff

**Files:**
- Modify: `docs/superpowers/specs/2026-07-18-r1-workspace-directory-repositories-design.md`
- Modify: `docs/CURSOR_CODEX_HANDOFF.md`
- Modify: `docs/superpowers/specs/2026-07-18-r1-directory-constraint-error-mapping-design.md` (Status → Approved design)

**Interfaces:**
- Consumes: Task 1 behavior
- Produces: documented error contract + handoff ready for review

- [ ] **Step 1: Update predecessor §8 table**

Replace the error table rows (keep BOLA paragraph) with:

| Code | When |
|---|---|
| `DIRECTORY_NOT_FOUND` | Required target row missing (membership/role/link end, get-by-id used as write precondition), **or** SQLite `FOREIGN KEY` violation on a write. Prefer this over boolean “false” for write preconditions. |
| `DIRECTORY_REVISION_CONFLICT` | CAS mismatch |
| `DIRECTORY_CONFLICT` | Unique / primary-key constraint on active link, membership, role grant, or equivalent unique write (`SQLITE_CONSTRAINT_UNIQUE` / `SQLITE_CONSTRAINT_PRIMARYKEY`) |
| `DIRECTORY_INVALID` | Domain validation failure, corrupt/missing revision row, **or** other SQLite constraints (CHECK / NOT NULL / …) |

Also add under §10.2 contract list:

`8. createMembership (or link) with missing FK target → DIRECTORY_NOT_FOUND; revision unchanged.`

- [ ] **Step 2: Mark follow-up design Approved; update handoff**

In `2026-07-18-r1-directory-constraint-error-mapping-design.md`, set:

`**Status:** Approved design`

In `docs/CURSOR_CODEX_HANDOFF.md` current-state block:

- Workflow: `READY_FOR_CODEX_REVIEW` (or Cursor-internal review if that is the active mode)
- Current task: Directory constraint error mapping follow-up
- Implementation SHA: this Task 2 commit tip after Step 3
- Note remaining open: claim / attendance / last-owner / audit
- Do not touch historical log entries for other slices beyond an append

- [ ] **Step 3: Commit**

```bash
git add \
  docs/superpowers/specs/2026-07-18-r1-workspace-directory-repositories-design.md \
  docs/superpowers/specs/2026-07-18-r1-directory-constraint-error-mapping-design.md \
  docs/CURSOR_CODEX_HANDOFF.md
git commit -m "$(cat <<'EOF'
docs(r1): clarify directory constraint error mapping

Align predecessor §8 with UNIQUE/PK vs FOREIGNKEY vs other
SQLITE_CONSTRAINT* codes and mark the follow-up design approved.
EOF
)"
```

---

## Spec coverage checklist

| Spec section | Task |
|---|---|
| §1 Goal / mapping table | 1 |
| §2 Non-goals | Global + review |
| §4.1 Mapping helper | 1 |
| §4.2 Call sites | 1 |
| §4.3 Spec amendment | 2 |
| §5 Testing (FK case) | 1 |
| §6 Files | 1–2 |

## Plan self-review

- No TBD/TODO placeholders in steps.
- FK test uses a shape-valid missing `accountId` so validators do not mask the SQL FK.
- Helper names and error codes match the approved design.
- Existing UNIQUE conflict tests remain the regression net for CONFLICT.

---

## Execution

Plan complete after commit. Offer Subagent-Driven vs Inline execution to the user.
