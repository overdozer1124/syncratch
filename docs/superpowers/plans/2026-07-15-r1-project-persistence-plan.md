# R1 Project Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship membership-scoped, server-validated project persistence (revision CAS + idempotent saves, generation-aware autosave, immutable snapshots, child-process restart) without Scratch UI or Google OAuth.

**Architecture:** `AuthContext` resolves identity only; `ProjectAccessPolicy` reads durable SQLite ownership/members; `project-service` implements idempotent save + CAS; SQLite + atomic FS snapshots behind ports; Hono HTTP; Vitest acceptance with child-process restart.

**Tech Stack (pinned):** TypeScript, pnpm, Vitest, **better-sqlite3**, **Hono** (Node adapter), Node 24+. Spec: `docs/superpowers/specs/2026-07-15-r1-project-persistence-design.md`.

## Global Constraints

- Do not alter Gate 0 Technical Go verdict  
- No Scratch GUI / Google OAuth body  
- Server clock for timestamps  
- Never trust body user/org for authz  
- `validateProject` + full `contentHash` before head mutation  
- `schemaVersion === document.schemaVersion` enforced  
- Snapshots in this slice: **explicit API only** (no autosave-threshold snapshots)  
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
export function assertEnvelope(value: unknown): ProjectEnvelopeV1
export function richFixtureDocument(): ProjectDocument
// richFixture includes: 2+ sprites, variables, lists, broadcasts, extensions, Japanese strings
```

- [ ] **Step 1: Failing tests**
  - canonicalize stable under key reorder  
  - hash changes if `lists` / `broadcasts` / `extensions` / `meta` change  
  - `richFixtureDocument` passes `validateProject`  
  - assertEnvelope rejects `schemaVersion !== document.schemaVersion`

- [ ] **Step 2: Implement** deterministic JSON (sorted keys / sorted target ids / sorted block ids)

- [ ] **Step 3: PASS; commit** `feat(project-envelope): full document canonicalization and hash`

---

### Task 3: project-service — access policy, idempotent save, CAS

**Files:**
- Create: `packages/project-service/src/ports.ts`, `access.ts`, `service.ts`, `errors.ts`, `service.test.ts`, `concurrency.test.ts`

**Interfaces:**
```typescript
export interface ProjectAccessPolicy {
  assertCan(principal: AuthPrincipal, projectId: string, action: "read"|"write"|"admin"): Promise<void>
}
export interface ProjectRepository {
  withTransaction<T>(fn: (tx: ProjectRepositoryTx) => Promise<T> | T): Promise<T>
}
export interface ProjectRepositoryTx {
  createProject(...): ProjectEnvelopeV1
  listProjectSummariesForMember(userId: string, organizationId: string): Array<{projectId,title,revision}>
  getHead(projectId: string): ProjectEnvelopeV1 | null
  findRevisionByTransactionId(projectId: string, transactionId: string): ProjectEnvelopeV1 | null
  /** CAS update head + insert revision; throws StaleRevisionError if CAS fails */
  commitRevision(args: {
    projectId: string
    baseRevision: number
    transactionId: string
    envelope: ProjectEnvelopeV1
    contentHash: string
  }): ProjectEnvelopeV1
}
export interface SnapshotStore { /* putAtomic, get, list, gcOrphans */ }

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

Save order **exactly** as design §5 (lookup transactionId → payload match → CAS).

- [ ] **Step 1: Failing unit tests (in-memory fake repo)**
  - non-member same org: list empty; get/save → NotFound/Forbidden  
  - create then member-only list contains project  
  - idempotent: second save same transactionId+hash returns same revision without bump  
  - same transactionId different hash → TransactionPayloadMismatchError  
  - stale baseRevision → StaleRevisionError; head hash unchanged  
  - invalid doc → SchemaInvalidError  
  - snapshot restore creates new revision; prior revision still gettable via fake  
  - schemaVersion mismatch rejected  

- [ ] **Step 2: Failing concurrency test** — parallel `commitRevision` / `saveDocument` with same base; exactly one success (use fake with mutex mimicking CAS **or** run against sqlite in Task 4; prefer sqlite in Task 4 if fake can't be fair — **required in Task 4**)

- [ ] **Step 3: Implement service + AccessPolicy reading repo membership APIs**

- [ ] **Step 4: PASS unit tests; commit** `feat(project-service): durable ACL, idempotent save, snapshot restore`

---

### Task 4: SQLite adapter + FS snapshots + contract tests

**Files:**
- Create: `packages/project-store-sqlite/**`
- Create: `packages/project-snapshots-fs/**`
- Create: `packages/project-service/src/repository.contract.test.ts` (runs against sqlite adapter)

**Pinned:** `better-sqlite3` only.

Snapshot put:

1. write `*.tmp`  
2. `fsync`  
3. `rename` → final  
4. DB insert  
5. On DB failure: orphan remains; `gcOrphans()` removes files with no DB row  

- [ ] **Step 1: Contract tests** — restart = new `ProjectRepository` instance on same file; member ACL; CAS concurrent saves (two connections / Promise.all) → one success one stale  

- [ ] **Step 2: Implement migrations + adapters**

- [ ] **Step 3: PASS; commit** `feat: sqlite project store and atomic snapshot files`

---

### Task 5: Hono HTTP server

**Files:**
- Create: `apps/r1-persist-server/src/server.ts`, `main.ts`, `server.test.ts`

**Pinned:** Hono + `@hono/node-server`.

Map errors to status codes; list endpoint uses membership query only.

- [ ] **Step 1: HTTP tests** for create/save/get/409/422/idempotent replay  

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
  - retry uses **same** transactionId + same payload bytes  
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

Also run tests §9 items 2–9 from design (can be same file; concurrency may call service/sqlite directly).

- [ ] **Step 1: Write failing acceptance suite**

- [ ] **Step 2: Wire demo package scripts; PASS**

- [ ] **Step 3: Commit** `test(r1): persistence acceptance with child-process restart`

---

### Task 8: Docs + separate CI workflow

**Files:**
- Create: `docs/r1/PERSISTENCE.md`
- Create: `.github/workflows/r1-persist.yml` (does **not** gate Gate 0)

- [ ] Document stub headers, data dir, orphan GC, pinned deps  
- [ ] CI: build + `r1-persist-demo` tests  
- [ ] Commit `docs(r1): persistence runbook and CI`

---

## Spec coverage self-check

| Requirement | Task |
|---|---|
| Auth identity ≠ durable ACL | 1, 3, 4 |
| Membership-only list/get | 3, 5, 7 |
| Idempotent transactionId + payload hash | 3, 5, 7 |
| CAS concurrent save | 4, 7 |
| Autosave generation / dispose | 6, 7 |
| Full canonicalization + rich fixture | 2, 7 |
| Child-process restart | 7 |
| Atomic snapshot + orphan GC | 4 |
| Restore re-hash + schema | 3, 7 |
| schemaVersion equality | 2, 3 |
| better-sqlite3 + Hono pinned | 4, 5 |
| Explicit snapshots only | 3, 5 (no threshold job) |

## Execution gate

**Do not start Tasks until this revised design is approved.**  
