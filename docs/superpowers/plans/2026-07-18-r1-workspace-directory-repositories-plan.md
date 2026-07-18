# R1 Workspace Directory Repositories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single `WorkspaceDirectoryRepository` port and SQLite adapter, wired as `directoryRepo` on `openSqliteStore`, covering identity/membership reads and CAS-gated minimal writes.

**Architecture:** Mirror `AuthRepository`: domain port in `@blocksync/workspace-directory`, better-sqlite3 adapter in `@blocksync/project-store-sqlite`, shared connection, synchronous `withTransaction`. Every management write checks `workspace_directory_revisions` then bumps revision in the same transaction. No `audit_events`.

**Tech Stack:** TypeScript, pnpm, Vitest, better-sqlite3, existing `workspace-directory` models/validators, legacy fixture helpers.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-18-r1-workspace-directory-repositories-design.md`
- Tables in scope only: `workspaces`, `user_accounts`, `people`,
  `person_account_links`, `workspace_memberships`, `role_assignments`
  (workspace scope), `workspace_directory_revisions`.
- Do not write `audit_events`, school/roster/import tables, claim tables, or
  `user_accounts` mutations.
- Do not implement last-owner protection, attendance uniqueness, API/UI, or
  auth-principal cutover.
- `role_assignments` writes are workspace-scope only
  (`scope_kind='workspace'`).
- Every management write is CAS-gated on the caller's `workspaceId` +
  `expectedRevision`.
- Port does not authorize; missing cross-tenant write targets throw
  `DIRECTORY_NOT_FOUND`.
- Synchronous transactions only; no `await` inside `withTransaction`.
- Do not touch or stage `docs/ai-platform/`.
- Keep `workspace-directory` free of SQLite / hono / react /
  `project-store-sqlite` imports.

---

## File Map

| Path | Responsibility |
|---|---|
| `packages/workspace-directory/src/errors.ts` | `DirectoryError` + codes |
| `packages/workspace-directory/src/repository.ts` | Port interfaces |
| `packages/workspace-directory/src/index.ts` | Re-export port + errors |
| `packages/workspace-directory/src/package-boundary.test.ts` | Include new source files |
| `packages/workspace-directory/src/repository.test.ts` | Error class + export smoke |
| `packages/project-store-sqlite/package.json` | Add `@blocksync/workspace-directory` dependency |
| `packages/project-store-sqlite/src/directory-repository.ts` | SQLite adapter |
| `packages/project-store-sqlite/src/directory-repository.contract.test.ts` | Read/write/CAS/BOLA contracts |
| `packages/project-store-sqlite/src/store.ts` | Wire `directoryRepo` |
| `packages/project-store-sqlite/src/index.ts` | Re-export factory/types if needed |
| `docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md` | Note thin Task 4 progress |
| `docs/CURSOR_CODEX_HANDOFF.md` | Slice status |

---

### Task 1: Port types and DirectoryError

**Files:**
- Create: `packages/workspace-directory/src/errors.ts`
- Create: `packages/workspace-directory/src/repository.ts`
- Create: `packages/workspace-directory/src/repository.test.ts`
- Modify: `packages/workspace-directory/src/index.ts`
- Modify: `packages/workspace-directory/src/package-boundary.test.ts`

**Interfaces:**

```ts
// errors.ts
export type DirectoryErrorCode =
  | "DIRECTORY_NOT_FOUND"
  | "DIRECTORY_REVISION_CONFLICT"
  | "DIRECTORY_CONFLICT"
  | "DIRECTORY_INVALID";

export class DirectoryError extends Error {
  readonly code: DirectoryErrorCode;
  constructor(code: DirectoryErrorCode, message: string) {
    super(message);
    this.name = "DirectoryError";
    this.code = code;
  }
}

// repository.ts — method signatures must match the approved design §6
export interface DirectoryRevisionState {
  revision: number;
  updatedAt: string; // UtcDateTime string
}

export interface WorkspaceDirectoryRepository {
  withTransaction<T>(fn: (tx: WorkspaceDirectoryRepositoryTx) => T): T;
}

export interface WorkspaceDirectoryRepositoryTx {
  getWorkspace(workspaceId: string): Workspace | null;
  listWorkspacesForAccount(accountId: string): Workspace[];
  getUserAccount(accountId: string): UserAccount | null;
  getPerson(personId: string): Person | null;
  getActivePersonAccountLinkByAccount(
    accountId: string,
  ): PersonAccountLink | null;
  getActivePersonAccountLinkByPerson(
    personId: string,
  ): PersonAccountLink | null;
  listMembershipsForWorkspace(
    workspaceId: string,
    options?: {includeEnded?: boolean},
  ): WorkspaceMembership[];
  listMembershipsForAccount(
    accountId: string,
    options?: {includeEnded?: boolean},
  ): WorkspaceMembership[];
  listWorkspaceRoleAssignments(
    workspaceId: string,
    options?: {includeEnded?: boolean},
  ): RoleAssignment[]; // only scope.kind === "workspace"
  getDirectoryRevision(workspaceId: string): DirectoryRevisionState | null;

  createWorkspace(input: {
    workspace: Workspace;
    initialRevision?: number;
  }): DirectoryRevisionState;

  createPerson(input: {
    workspaceId: string;
    expectedRevision: number;
    person: Person;
  }): {revision: number; person: Person};

  updatePerson(input: {
    workspaceId: string;
    expectedRevision: number;
    personId: string;
    patch: {displayName?: string; status?: Person["status"]};
    updatedAt: string;
  }): {revision: number; person: Person};

  linkPersonAccount(input: {
    workspaceId: string;
    expectedRevision: number;
    link: PersonAccountLink;
  }): {revision: number; link: PersonAccountLink};

  unlinkPersonAccount(input: {
    workspaceId: string;
    expectedRevision: number;
    linkId: string;
    unlinkedAt: string;
  }): {revision: number; link: PersonAccountLink};

  createMembership(input: {
    expectedRevision: number;
    membership: WorkspaceMembership;
  }): {revision: number; membership: WorkspaceMembership};

  endMembership(input: {
    expectedRevision: number;
    membershipId: string;
    endedAt: string;
  }): {revision: number; membership: WorkspaceMembership};

  grantWorkspaceRole(input: {
    expectedRevision: number;
    assignment: Extract<
      RoleAssignment,
      {scope: {kind: "workspace"}}
    >;
  }): {revision: number; assignment: RoleAssignment};

  endWorkspaceRole(input: {
    expectedRevision: number;
    assignmentId: string;
    endedAt: string;
  }): {revision: number; assignment: RoleAssignment};
}
```

Import domain types (`Person`, `Workspace`, `UserAccount`, …) from `./models.js`.
If `UserAccount` is not yet exported as a named interface in models, add a
minimal interface matching `user_accounts` columns used by reads:

```ts
export interface UserAccount {
  id: UserAccountId;
  displayName: string | null;
  email: string | null;
  status: "active" | "disabled";
  createdAt: UtcDateTime;
  updatedAt: UtcDateTime;
}
```

(and `validateUserAccount` if missing — keep fail-closed mapping).

- [ ] **Step 1: Write the failing export/error test**

```ts
// repository.test.ts
import {describe, expect, it} from "vitest";
import {DirectoryError} from "./errors.js";
import type {WorkspaceDirectoryRepository} from "./repository.js";

describe("directory repository port", () => {
  it("exposes DirectoryError codes", () => {
    const err = new DirectoryError("DIRECTORY_REVISION_CONFLICT", "stale");
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe("DIRECTORY_REVISION_CONFLICT");
    expect(err.name).toBe("DirectoryError");
  });

  it("types WorkspaceDirectoryRepository withTransaction", () => {
    const _typeCheck: WorkspaceDirectoryRepository = {
      withTransaction: (fn) => fn({} as never),
    };
    expect(typeof _typeCheck.withTransaction).toBe("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @blocksync/workspace-directory test -- src/repository.test.ts`  
Expected: FAIL (module not found / missing exports)

- [ ] **Step 3: Implement errors + repository port + exports**

Create `errors.ts` and `repository.ts` as above. Update `index.ts`:

```ts
export * from "./errors.js";
export * from "./repository.js";
// keep existing exports
```

Update `package-boundary.test.ts` `sources` array to include `errors.ts` and
`repository.ts`.

Add `UserAccount` (+ validator) to `models.ts` only if not already present.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @blocksync/workspace-directory test`  
Expected: PASS (including package-boundary)

Run: `pnpm --filter @blocksync/workspace-directory typecheck`  
Expected: exit 0

- [ ] **Step 5: Commit**

```bash
git add packages/workspace-directory
git commit -m "$(cat <<'EOF'
feat(directory): add workspace directory repository port

Define DirectoryError codes and the WorkspaceDirectoryRepository
transaction surface for the thin identity/membership slice.
EOF
)"
```

---

### Task 2: Dependency + failing read contracts

**Files:**
- Modify: `packages/project-store-sqlite/package.json` (and lockfile via pnpm)
- Create: `packages/project-store-sqlite/src/directory-repository.contract.test.ts`
- Create: `packages/project-store-sqlite/src/directory-repository.ts` (stub that throws)

**Interfaces:**
- Consumes: `WorkspaceDirectoryRepository`, `DirectoryError` from
  `@blocksync/workspace-directory`
- Produces: `createSqliteWorkspaceDirectoryRepository(db)` stub; tests import it

- [ ] **Step 1: Add workspace dependency**

```bash
pnpm add @blocksync/workspace-directory@workspace:* --filter @blocksync/project-store-sqlite
```

Keep `package.json` dependency keys alphabetically ordered.

- [ ] **Step 2: Write failing read contract tests**

```ts
// directory-repository.contract.test.ts (excerpt — include full cases in file)
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {DirectoryError} from "@blocksync/workspace-directory";
import {copyLegacyR1Fixture} from "./fixtures/legacy-r1-fixture.js";
import {openSqliteStore} from "./store.js";
import {createSqliteWorkspaceDirectoryRepository} from "./directory-repository.js";
import Database from "better-sqlite3";
import {configureSqliteConnection} from "./migrations/configure.js";
import {runSchemaMigrations} from "./migrations/index.js";

function openMigratedDb(dbPath: string) {
  const db = new Database(dbPath);
  configureSqliteConnection(db);
  runSchemaMigrations(db);
  return db;
}

describe("sqlite workspace directory repository — reads", () => {
  const closers: Array<() => void> = [];
  afterEach(() => {
    while (closers.length) closers.pop()!();
  });

  it("reads backfilled workspace identity rows from a copied legacy fixture", () => {
    const dir = mkdtempSync(join(tmpdir(), "dir-read-"));
    const copied = copyLegacyR1Fixture(dir);
    const db = openMigratedDb(copied.dbPath);
    closers.push(() => db.close());
    const repo = createSqliteWorkspaceDirectoryRepository(db);

    repo.withTransaction((tx) => {
      const workspaces = db
        .prepare(`SELECT id FROM workspaces ORDER BY id`)
        .all() as Array<{id: string}>;
      expect(workspaces.length).toBeGreaterThan(0);
      const ws = tx.getWorkspace(workspaces[0]!.id);
      expect(ws).not.toBeNull();
      expect(ws!.id).toBe(workspaces[0]!.id);
      expect(["personal", "casual", "school"]).toContain(ws!.kind);

      const rev = tx.getDirectoryRevision(workspaces[0]!.id);
      expect(rev).not.toBeNull();
      expect(rev!.revision).toBeGreaterThanOrEqual(0);

      const people = db
        .prepare(`SELECT id FROM people ORDER BY id`)
        .all() as Array<{id: string}>;
      expect(tx.getPerson(people[0]!.id)?.id).toBe(people[0]!.id);
    });
  });

  it("lists workspaces for an account with an active membership only", () => {
    const dir = mkdtempSync(join(tmpdir(), "dir-list-ws-"));
    const copied = copyLegacyR1Fixture(dir);
    const db = openMigratedDb(copied.dbPath);
    closers.push(() => db.close());
    const repo = createSqliteWorkspaceDirectoryRepository(db);

    repo.withTransaction((tx) => {
      const row = db
        .prepare(
          `SELECT account_id AS accountId, workspace_id AS workspaceId
           FROM workspace_memberships
           WHERE status = 'active'
           LIMIT 1`,
        )
        .get() as {accountId: string; workspaceId: string};
      const listed = tx.listWorkspacesForAccount(row.accountId);
      expect(listed.some((w) => w.id === row.workspaceId)).toBe(true);
    });
  });
});
```

Also assert active link getters and membership/role list filters in the same
file (active-only default; `includeEnded: true` returns ended rows when
present).

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @blocksync/project-store-sqlite test -- src/directory-repository.contract.test.ts`  
Expected: FAIL (cannot resolve `./directory-repository.js` or missing export)

- [ ] **Step 4: Add stub factory**

```ts
// directory-repository.ts
import type Database from "better-sqlite3";
import type {WorkspaceDirectoryRepository} from "@blocksync/workspace-directory";

export function createSqliteWorkspaceDirectoryRepository(
  _db: Database.Database,
): WorkspaceDirectoryRepository {
  throw new Error("not implemented");
}
```

Re-run: Expected FAIL with `not implemented` or type errors once stub returns
an object — prefer stub that returns `{ withTransaction() { throw ... } }` so
tests reach assertions and fail on missing methods:

```ts
export function createSqliteWorkspaceDirectoryRepository(
  db: Database.Database,
): WorkspaceDirectoryRepository {
  return {
    withTransaction(fn) {
      return db.transaction(() =>
        fn(null as unknown as never),
      )();
    },
  };
}
```

Expected: FAIL when calling `tx.getWorkspace` (null tx).

- [ ] **Step 5: Commit failing tests + stub + dependency**

```bash
git add packages/project-store-sqlite/package.json pnpm-lock.yaml \
  packages/project-store-sqlite/src/directory-repository.ts \
  packages/project-store-sqlite/src/directory-repository.contract.test.ts
git commit -m "$(cat <<'EOF'
test(store): add failing directory repository read contracts

Depend on workspace-directory and pin read expectations against a
copied legacy fixture before implementing the SQLite adapter.
EOF
)"
```

---

### Task 3: Implement reads

**Files:**
- Modify: `packages/project-store-sqlite/src/directory-repository.ts`
- Modify: `packages/project-store-sqlite/src/directory-repository.contract.test.ts` (keep green)

**Interfaces:**
- Consumes: Task 1 port; better-sqlite3 `db`
- Produces: working read methods; writes may still throw `DirectoryError("DIRECTORY_INVALID", "not implemented")` until Task 4

- [ ] **Step 1: Implement mapping + read methods**

In `directory-repository.ts`:

- Prepare statements for each read.
- Map rows through `validateWorkspace` / `validatePerson` /
  `validatePersonAccountLink` / `validateWorkspaceMembership` /
  `validateRoleAssignment` / `validateUserAccount`. On `!ok`, throw
  `new DirectoryError("DIRECTORY_INVALID", ...)`.
- `listWorkspaceRoleAssignments` filters `scope_kind = 'workspace'` and
  `workspace_id = ?`.
- `withTransaction(fn)` → `db.transaction(() => fn(tx))()`.

Keep write methods throwing:

```ts
throw new DirectoryError("DIRECTORY_INVALID", "write not implemented");
```

until Task 4 (or implement no-ops only if tests do not call them yet).

- [ ] **Step 2: Run read contracts**

Run: `pnpm --filter @blocksync/project-store-sqlite test -- src/directory-repository.contract.test.ts`  
Expected: PASS for read cases

- [ ] **Step 3: Commit**

```bash
git add packages/project-store-sqlite/src/directory-repository.ts \
  packages/project-store-sqlite/src/directory-repository.contract.test.ts
git commit -m "$(cat <<'EOF'
feat(store): read workspace directory identity rows

Map workspaces, people, links, memberships, and workspace-scoped roles
through domain validators on the shared SQLite connection.
EOF
)"
```

---

### Task 4: CAS-gated minimal writes

**Files:**
- Modify: `packages/project-store-sqlite/src/directory-repository.ts`
- Modify: `packages/project-store-sqlite/src/directory-repository.contract.test.ts`

**Interfaces:**
- Consumes: read path + revision table
- Produces: all write methods from Task 1 interfaces

Shared helper (inside adapter):

```ts
function assertAndBumpRevision(
  workspaceId: string,
  expectedRevision: number,
  updatedAt: string,
): number {
  const row = getRevisionStmt.get(workspaceId) as
    | {revision: number}
    | undefined;
  if (!row) {
    throw new DirectoryError(
      "DIRECTORY_INVALID",
      `missing directory revision for workspace ${workspaceId}`,
    );
  }
  if (row.revision !== expectedRevision) {
    throw new DirectoryError(
      "DIRECTORY_REVISION_CONFLICT",
      `expected revision ${expectedRevision}, found ${row.revision}`,
    );
  }
  bumpRevisionStmt.run({workspaceId, updatedAt});
  return expectedRevision + 1;
}
```

For `createMembership` / `endMembership` / role grant/end, derive
`workspaceId` from the membership/assignment row (membership.workspaceId /
assignment.scope.workspaceId). Person/link writes use the explicit
`workspaceId` argument from the design.

Map SQLite unique violations (`SQLITE_CONSTRAINT_UNIQUE` /
`SQLITE_CONSTRAINT`) to `DIRECTORY_CONFLICT`.

Missing targets for end/unlink → `DIRECTORY_NOT_FOUND`.

- [ ] **Step 1: Write failing write/CAS/BOLA tests**

```ts
describe("sqlite workspace directory repository — writes", () => {
  it("createPerson bumps directory revision under CAS", () => {
    const dir = mkdtempSync(join(tmpdir(), "dir-write-"));
    const copied = copyLegacyR1Fixture(dir);
    const db = openMigratedDb(copied.dbPath);
    const repo = createSqliteWorkspaceDirectoryRepository(db);
    const workspaceId = (
      db.prepare(`SELECT id FROM workspaces LIMIT 1`).get() as {id: string}
    ).id;
    const before = repo.withTransaction((tx) =>
      tx.getDirectoryRevision(workspaceId)!,
    );

    const person = {
      id: "11111111-1111-4111-8111-111111111111",
      displayName: "New Person",
      status: "active" as const,
      createdAt: "2026-07-18T00:00:00.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
    };

    const result = repo.withTransaction((tx) =>
      tx.createPerson({
        workspaceId,
        expectedRevision: before.revision,
        person: person as never,
      }),
    );
    expect(result.revision).toBe(before.revision + 1);
    expect(
      repo.withTransaction((tx) => tx.getPerson(person.id))?.displayName,
    ).toBe("New Person");
    db.close();
  });

  it("stale expectedRevision conflicts and rolls back", () => {
    const dir = mkdtempSync(join(tmpdir(), "dir-cas-"));
    const copied = copyLegacyR1Fixture(dir);
    const db = openMigratedDb(copied.dbPath);
    const repo = createSqliteWorkspaceDirectoryRepository(db);
    const workspaceId = (
      db.prepare(`SELECT id FROM workspaces LIMIT 1`).get() as {id: string}
    ).id;
    const before = repo.withTransaction((tx) =>
      tx.getDirectoryRevision(workspaceId)!,
    );

    expect(() =>
      repo.withTransaction((tx) =>
        tx.createPerson({
          workspaceId,
          expectedRevision: before.revision - 1,
          person: {
            id: "22222222-2222-4222-8222-222222222222",
            displayName: "Nope",
            status: "active",
            createdAt: "2026-07-18T00:00:00.000Z",
            updatedAt: "2026-07-18T00:00:00.000Z",
          } as never,
        }),
      ),
    ).toThrow(DirectoryError);

    expect(
      repo.withTransaction((tx) => tx.getDirectoryRevision(workspaceId))
        ?.revision,
    ).toBe(before.revision);
    expect(
      repo.withTransaction((tx) =>
        tx.getPerson("22222222-2222-4222-8222-222222222222"),
      ),
    ).toBeNull();
    db.close();
  });

  it("duplicate active membership yields DIRECTORY_CONFLICT", () => {
    // insert second active membership for same (workspace_id, account_id)
    // expect DirectoryError code DIRECTORY_CONFLICT and unchanged revision
  });

  it("ending a foreign membership id yields DIRECTORY_NOT_FOUND", () => {
    // use a real membership id but CAS against a different workspace's revision
    // OR end a non-existent id — prefer non-existent id for NOT_FOUND
  });
});
```

Fill the conflict/BOLA tests with concrete SQL setup using fixture account IDs.
Also cover: `linkPersonAccount` / `unlinkPersonAccount`, `createMembership` /
`endMembership`, `grantWorkspaceRole` / `endWorkspaceRole`, optional
`createWorkspace` on a fresh migrated empty DB (no fixture).

- [ ] **Step 2: Run to verify FAIL**

Run: `pnpm --filter @blocksync/project-store-sqlite test -- src/directory-repository.contract.test.ts`  
Expected: write cases FAIL (`write not implemented` or wrong behavior)

- [ ] **Step 3: Implement writes**

Implement all write methods with `assertAndBumpRevision` inside the same
`db.transaction` callback as the DML.

`createWorkspace`:

1. Validate workspace
2. `INSERT INTO workspaces …`
3. `INSERT INTO workspace_directory_revisions (workspace_id, revision, updated_at) VALUES (?, @initialRevision ?? 0, ?)`
4. Return `{ revision: initialRevision ?? 0, updatedAt }`

- [ ] **Step 4: Run to verify PASS**

Run: `pnpm --filter @blocksync/project-store-sqlite test -- src/directory-repository.contract.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/project-store-sqlite/src/directory-repository.ts \
  packages/project-store-sqlite/src/directory-repository.contract.test.ts
git commit -m "$(cat <<'EOF'
feat(store): cas-gated workspace directory writes

Add minimal identity/membership mutations with directory revision CAS,
conflict mapping, and fail-closed not-found semantics.
EOF
)"
```

---

### Task 5: Store wiring + package gates

**Files:**
- Modify: `packages/project-store-sqlite/src/store.ts`
- Modify: `packages/project-store-sqlite/src/directory-repository.contract.test.ts` (add openSqliteStore smoke)
- Modify: `docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md`
- Modify: `docs/CURSOR_CODEX_HANDOFF.md`
- Modify: `docs/superpowers/specs/2026-07-18-r1-workspace-directory-repositories-design.md` (Status → Approved)

**Interfaces:**
- Consumes: `createSqliteWorkspaceDirectoryRepository`
- Produces: `SqliteStore.directoryRepo: WorkspaceDirectoryRepository`

- [ ] **Step 1: Write failing store smoke**

```ts
it("openSqliteStore exposes directoryRepo on the shared connection", () => {
  const dir = mkdtempSync(join(tmpdir(), "dir-store-"));
  const store = openSqliteStore({dbPath: join(dir, "db.sqlite")});
  try {
    const created = store.directoryRepo.withTransaction((tx) =>
      tx.createWorkspace({
        workspace: {
          id: "ws-smoke",
          kind: "personal",
          name: "Smoke",
          createdAt: "2026-07-18T00:00:00.000Z",
          updatedAt: "2026-07-18T00:00:00.000Z",
        } as never,
      }),
    );
    expect(created.revision).toBe(0);
    expect(
      store.directoryRepo.withTransaction((tx) => tx.getWorkspace("ws-smoke"))
        ?.name,
    ).toBe("Smoke");
  } finally {
    store.close();
  }
});
```

- [ ] **Step 2: Run to verify FAIL** (property missing on SqliteStore)

- [ ] **Step 3: Wire store**

```ts
import type {WorkspaceDirectoryRepository} from "@blocksync/workspace-directory";
import {createSqliteWorkspaceDirectoryRepository} from "./directory-repository.js";

export interface SqliteStore {
  // existing fields…
  directoryRepo: WorkspaceDirectoryRepository;
}

// in openInitializedSqliteStore:
const directoryRepo = createSqliteWorkspaceDirectoryRepository(db);
return { projectRepo, authRepo, assetRepo, commitAssets, liveCatalog, directoryRepo, close() { db.close(); } };
```

- [ ] **Step 4: Run focused + package gates**

```bash
pnpm --filter @blocksync/workspace-directory typecheck
pnpm --filter @blocksync/workspace-directory test
pnpm --filter @blocksync/project-store-sqlite typecheck
pnpm --filter @blocksync/project-store-sqlite test
pnpm r1:persist:test
```

Expected: all exit 0

- [ ] **Step 5: Update roadmap + handoff + spec status**

In roster plan Task 4, add a note under the checkboxes:

```markdown
**Thin slice (2026-07-18):** identity/membership `directoryRepo` port + SQLite
adapter + CAS writes landed; claim/attendance/last-owner/audit remain open.
```

Mark completed thin-slice items that this work covers (contract tests for
CRUD subset, BOLA, store return). Leave claim/attendance/last-owner unchecked.

Update handoff to `READY_FOR_CODEX_REVIEW` / implementation complete for this
thin slice.

Set design doc Status to `Approved design`.

- [ ] **Step 6: Commit**

```bash
git add packages/project-store-sqlite/src/store.ts \
  packages/project-store-sqlite/src/directory-repository.contract.test.ts \
  docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md \
  docs/superpowers/specs/2026-07-18-r1-workspace-directory-repositories-design.md \
  docs/CURSOR_CODEX_HANDOFF.md
git commit -m "$(cat <<'EOF'
feat(store): expose directoryRepo from openSqliteStore

Wire the workspace directory repository on the shared SQLite store and
record the thin Task 4 slice for review.
EOF
)"
```

---

## Spec coverage checklist

| Spec section | Task |
|---|---|
| §4 Architecture / dependency direction | 1, 3, 5 |
| §5 Tables in scope | 3, 4 |
| §6.1 Reads | 2, 3 |
| §6.2 Writes + optional createWorkspace | 4 |
| §6.3 Write bans | 4 (tests must not insert non-workspace scopes) |
| §7 CAS algorithm | 4 |
| §7.2 Person/link workspace gate | 4 |
| §8 Error codes | 1, 4 |
| §9 Store wiring | 5 |
| §10 Testing / gates | 2–5 |
| Non-goals (no audit/claim/school/API) | Global + Task 4/5 review |

## Plan self-review

- No TBD/TODO placeholders in steps.
- Method names match design §6 and Task 1 Interfaces block.
- `UserAccount` addition called out if missing from models.
- Dependency add is explicit (`pnpm add`).
- TDD order preserved per task.

---

## Execution

Plan complete after commit. Offer Subagent-Driven vs Inline execution to the user.
