# R1 Project Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship membership-scoped, server-validated project persistence (revision CAS + idempotent saves, generation-aware autosave, immutable snapshots, child-process restart) without Scratch UI or Google OAuth.

**Architecture:** `AuthContext` resolves identity only; `ProjectAccessPolicy` reads durable SQLite ownership/members; `project-service` implements idempotent save + sync CAS TX; SQLite + atomic FS snapshots behind ports; Hono HTTP; Vitest acceptance with child-process restart.

**Tech Stack (pinned):** TypeScript, pnpm, Vitest, **better-sqlite3**, **Hono** (Node adapter), Node 24+. Spec: `docs/superpowers/specs/2026-07-15-r1-project-persistence-design.md`.

## Global Constraints

- Do not alter Gate 0 Technical Go verdict
- No Scratch GUI / Google OAuth body
- Server clock for timestamps
- Never trust body user/org for authz
- `validateProject` + full `contentHash` before head mutation
- Client `schemaVersion` must equal `document.schemaVersion`
- Idempotency uses `requestHash` (op + schemaVersion + contentHash), not contentHash alone
- `withTransaction` callback is **synchronous only** (`fn: (tx) => T` returns `T`); no `await` inside
- `AuthContext.resolve()` completes **before** any SQLite transaction
- Snapshots in this slice: **explicit API only** (no autosave-threshold snapshots)
- Snapshot restore lookup always `(projectId, snapshotId)`
- SQLite SQL lives only in `project-store-sqlite`; service tests use port fakes + a shared repository contract suite
- Data dir: `apps/r1-persist-server/data/` (gitignored) + tests use temp dirs
- TDD per task

---

### Task 1: auth-context (identity only)

**Files:**
- Create: `packages/auth-context/package.json`, `tsconfig.json`, `src/index.ts`, `src/index.test.ts`
- Modify: `.gitignore` — `apps/r1-persist-server/data/`, `**/*.sqlite`

**Interfaces:**
```typescript
export interface AuthRequestHints { headers: Record<string, string | undefined> }
export interface AuthPrincipal { userId: string; organizationId: string; displayName?: string }
export interface AuthContext {
  resolve(request: AuthRequestHints): Promise<AuthPrincipal>
}
export class StubAuthContext implements AuthContext
// NO canAccessProject, NO registerProject
```

- [ ] **Step 1: Failing tests** — `x-user-id: user-a` → `{ userId: "user-a", organizationId: "org-demo" }`; unknown user throws; no ACL APIs exported

- [ ] **Step 2: Implement StubAuthContext**

- [ ] **Step 3: PASS; commit** `feat(auth-context): identity-only StubAuthContext`

---

### Task 2: project-envelope — full canonicalization

**Files:**
- Create: `packages/project-envelope/**`

**Interfaces:**
```typescript
export const PROJECT_FORMAT = "blocksync.project/v1" as const
export interface ProjectEnvelopeV1 { /* as design §4, includes contentHash */ }
export function emptyDocument(): ProjectDocument
export function canonicalizeDocument(doc: ProjectDocument): string
export function contentHash(doc: ProjectDocument): string // sha256 hex of canonicalize
export function requestHash(args: {
  op: "save_document" | "restore"
  schemaVersion: number
  contentHash: string
}): string
export function assertEnvelope(value: unknown): ProjectEnvelopeV1
export function richFixtureDocument(): ProjectDocument
// richFixture includes: 2+ sprites, variables, lists, broadcasts, extensions, Japanese strings
```

- [ ] **Step 1: Failing tests**
  - canonicalize stable under key reorder
  - hash changes if `lists` / `broadcasts` / `extensions` / `meta` change
  - `richFixtureDocument` passes `validateProject`
  - assertEnvelope rejects `schemaVersion !== document.schemaVersion`
  - `requestHash` changes when `schemaVersion` or `op` changes with same contentHash

- [ ] **Step 2: Implement** deterministic JSON (sorted keys / sorted target ids / sorted block ids)

- [ ] **Step 3: PASS; commit** `feat(project-envelope): full document canonicalization and hash`

---

### Task 3: project-service — access policy, idempotent save, CAS

**Files:**
- Create: `packages/project-service/src/ports.ts`, `access.ts`, `service.ts`, `errors.ts`, `service.test.ts`

**Interfaces:**
```typescript
export interface ProjectAccessPolicy {
  assertCan(
    principal: AuthPrincipal,
    projectId: string,
    action: "read"|"write"|"admin",
    tx: ProjectRepositoryTx,
  ): void // SYNC
}

export interface ProjectRepository {
  /** SYNC callback only — never return a Promise from fn. */
  withTransaction<T>(fn: (tx: ProjectRepositoryTx) => T): T
}

export interface ProjectRepositoryTx {
  createProject(...): ProjectEnvelopeV1
  listProjectSummariesForMember(userId: string, organizationId: string): Array<{projectId,title,revision}>
  getHead(projectId: string): ProjectEnvelopeV1 | null
  findRevisionByTransactionId(projectId: string, transactionId: string): {
    envelope: ProjectEnvelopeV1
    requestHash: string
  } | null
  commitRevision(args: {
    projectId: string
    baseRevision: number
    transactionId: string
    envelope: ProjectEnvelopeV1
    contentHash: string
    requestHash: string
  }): ProjectEnvelopeV1
  getSnapshotMeta(projectId: string, snapshotId: string): SnapshotMeta | null
}

export interface SaveDocumentInput {
  projectId: string
  baseRevision: number
  transactionId: string
  schemaVersion: number
  document: ProjectDocument
}

export class TransactionPayloadMismatchError extends Error { code = "TRANSACTION_PAYLOAD_MISMATCH" }
export class StaleRevisionError extends Error { code = "STALE_REVISION" }
export class SchemaInvalidError extends Error { code = "SCHEMA_INVALID" }
export class SchemaVersionMismatchError extends Error { code = "SCHEMA_VERSION_MISMATCH" }
export class ForbiddenError extends Error { code = "FORBIDDEN" }
export class NotFoundError extends Error { code = "NOT_FOUND" }

export function createProjectService(deps: {
  auth: AuthContext
  access: ProjectAccessPolicy
  repo: ProjectRepository
  snapshots: SnapshotStore
  now: () => Date
}): ProjectService
```

Save order **exactly** as design §5:
1. `await auth.resolve` outside TX
2. validate + contentHash + schemaVersion check + requestHash outside TX (pure)
3. `repo.withTransaction(tx => { assertCan; lookup; CAS; insert })` — sync body

- [ ] **Step 1: Failing unit tests (in-memory fake repo with sync withTransaction)**
  - non-member same org: list empty; get/save → NotFound/Forbidden
  - create then member-only list contains project
  - idempotent: second save same transactionId + same requestHash returns same revision without bump
  - same transactionId, same document, **different schemaVersion** → TransactionPayloadMismatchError
  - same transactionId different content → TransactionPayloadMismatchError
  - stale baseRevision → StaleRevisionError; head hash unchanged
  - invalid doc → SchemaInvalidError
  - client schemaVersion !== document.schemaVersion → SchemaVersionMismatchError
  - snapshot restore creates new revision; prior revision still gettable via fake
  - restore uses `(projectId, snapshotId)`; wrong project → NotFound (BOLA unit)

- [ ] **Step 2: Implement service + AccessPolicy reading repo membership APIs (sync assertCan)**

- [ ] **Step 3: PASS unit tests; commit** `feat(project-service): durable ACL, idempotent save, snapshot restore`

---

### Task 4: SQLite adapter + FS snapshots + contract tests

**Files:**
- Create: `packages/project-store-sqlite/**`
- Create: `packages/project-snapshots-fs/**`
- Create: `packages/project-service/src/repository.contract.test.ts` (runs against sqlite adapter)

**Pinned:** `better-sqlite3` only. Implement `withTransaction` via `db.transaction((tx) => fn(...))()` — callback must not return a Promise.

Snapshot put:

1. write `{contentHash}.{uniqueSuffix}.tmp` (unique suffix per attempt)
2. `fsync`
3. If `{contentHash}.json` already exists: verify hash matches; unlink temp; reuse final
4. Else atomic `rename` → final
5. DB insert keyed by `(project_id, snapshot_id)`
6. On DB failure after file exists: orphan remains; `gcOrphans()` removes files with no DB row

- [ ] **Step 1: Contract tests**
  - reopen repository on same DB file (restart)
  - member ACL
  - CAS concurrent saves (Promise.all of async service methods; each uses sync TX) → one success one stale
  - **rollback:** throw inside `withTransaction` after partial writes → head/revisions unchanged
  - **BOLA:** cannot restore Project B snapshot id into Project A

- [ ] **Step 2: Implement migrations + adapters**

- [ ] **Step 3: PASS; commit** `feat: sqlite project store and atomic snapshot files`

---

### Task 5: Hono HTTP server

**Files:**
- Create: `apps/r1-persist-server/src/server.ts`, `main.ts`, `server.test.ts`

**Pinned:** Hono + `@hono/node-server`.

Map errors to status codes; list endpoint uses membership query only.

PUT `/v1/projects/:id/document` body: `{ baseRevision, transactionId, schemaVersion, document }`.

- [ ] **Step 1: HTTP tests** for create/save/get/409/422/schemaVersion mismatch/idempotent replay

- [ ] **Step 2: Implement routes**

- [ ] **Step 3: PASS; commit** `feat(r1-persist-server): Hono API`

---

### Task 6: Autosave with generation / pending document

**Files:**
- Create: `packages/project-autosave/src/index.ts`, `index.test.ts`

**Interfaces:**
```typescript
export type SaveState = "clean" | "dirty" | "saving" | "error" | "conflict"
export function createAutosaveController(opts: {
  debounceMs: number
  retryDelaysMs: number[]
  save: (args: {
    baseRevision: number
    transactionId: string
    schemaVersion: number
    document: ProjectDocument
  }) => Promise<{ revision: number }>
  getBaseRevision: () => number
  setBaseRevision: (r: number) => void
  onState?: (s: SaveState) => void
}): {
  getState(): SaveState
  notifyLocalEdit(document: ProjectDocument): void
  flush(): Promise<void>
  dispose(): void
}
```

- [ ] **Step 1: Fake-timer tests**
  - edit during `saving` → remains dirty after success; second save uses new baseRevision and **new** transactionId
  - retry uses **same** transactionId + same payload bytes (including schemaVersion)
  - success with no pending → `clean`
  - 409 → `conflict`, no retry
  - `dispose` then advance timers → no save calls / no onState

- [ ] **Step 2: Implement generation + pendingDocument**

- [ ] **Step 3: PASS; commit** `feat(project-autosave): generation-aware debounce autosave`

---

### Task 7: Acceptance — child-process restart + full hash

**Files:**
- Create: `apps/r1-persist-demo/src/persistence.acceptance.test.ts`
- Create: `apps/r1-persist-demo/src/server-child.mjs` (or ts) entry for spawn

**Restart protocol:**

1. Start server child with `R1_DATA_DIR=temp`
2. Create + edit rich fixture + autosave `flush`
3. Await save ACK (`revision` / `contentHash`)
4. Kill child (SIGTERM then SIGKILL)
5. Spawn **new** child same data dir
6. GET project → equal `revision` + `contentHash`

Also run design §9 items 2–11 as needed (concurrency / rollback / BOLA may live in Task 4 contract tests).

- [ ] **Step 1: Write failing acceptance suite**

- [ ] **Step 2: Wire demo package scripts; PASS**

- [ ] **Step 3: Commit** `test(r1): persistence acceptance with child-process restart`

---

### Task 8: Docs + separate CI workflow

**Files:**
- Create: `docs/r1/PERSISTENCE.md`
- Create: `.github/workflows/r1-persist.yml` (does **not** gate Gate 0)

- [ ] Document stub headers, data dir, orphan GC, pinned deps, sync TX rules
- [ ] CI: build + `r1-persist-demo` tests
- [ ] Commit `docs(r1): persistence runbook and CI`

---

## Spec coverage self-check

| Requirement | Task |
|---|---|
| Auth identity ≠ durable ACL | 1, 3, 4 |
| Membership-only list/get | 3, 5, 7 |
| Sync withTransaction; auth before TX | 3, 4 |
| TX rollback test | 4 |
| Client schemaVersion + SCHEMA_VERSION_MISMATCH | 2, 3, 5 |
| requestHash vs contentHash | 2, 3 |
| Idempotent transactionId + requestHash | 3, 5, 7 |
| CAS concurrent save | 4, 7 |
| Autosave generation / dispose | 6, 7 |
| Full canonicalization + rich fixture | 2, 7 |
| Child-process restart | 7 |
| Atomic snapshot + unique temp + orphan GC | 4 |
| Restore `(projectId, snapshotId)` + BOLA | 3, 4, 7 |
| better-sqlite3 + Hono pinned | 4, 5 |
| Explicit snapshots only | 3, 5 (no threshold job) |

## Execution gate

Design revisions above are binding. Proceed Task 1 → Task 8 with TDD and per-task commits.
