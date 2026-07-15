# R1 Project Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a stub-auth, server-validated project persistence path (create/list/get, revisioned save, debounce autosave, immutable snapshots, restart restore) without Scratch UI or Google OAuth.

**Architecture:** AuthContext + ProjectEnvelope + use-case service with SQLite/filesystem adapters behind ports; thin HTTP app + Vitest demo client. Structure gate reuses `@blocksync/project-schema`.

**Tech Stack:** TypeScript, pnpm workspace, Vitest, better-sqlite3 (or `node:sqlite` if Node 24 built-in preferred — pin **better-sqlite3** for sync API clarity), undici/fetch client, Node HTTP (`node:http` or `hono` — prefer **Hono** on Node for ergonomics). Spec: `docs/superpowers/specs/2026-07-15-r1-project-persistence-design.md`.

## Global Constraints

- Do not change Gate 0 Technical Go verdict or revert Gate 0 packages unless required for compile
- No Scratch GUI / Google OAuth implementation in this plan
- Server clock only for `updatedAt` / snapshot timestamps
- Never trust body `organizationId` / `userId` for authorization
- `validateProject` before any head mutation; reject leaves authority unchanged
- All new package APIs `@experimental`
- Data dir under `apps/r1-persist-server/data/` (gitignored)
- TDD: failing test → implement → pass → commit per task

---

### Task 1: Workspace scaffolding + auth-context

**Files:**
- Create: `packages/auth-context/package.json`
- Create: `packages/auth-context/tsconfig.json`
- Create: `packages/auth-context/src/index.ts`
- Create: `packages/auth-context/src/index.test.ts`
- Modify: `pnpm-workspace.yaml` (already `packages/*`)
- Modify: `.gitignore` — add `apps/r1-persist-server/data/`

**Interfaces:**
- Produces:
  ```typescript
  export interface AuthRequestHints { headers: Record<string, string | undefined> }
  export interface AuthPrincipal { userId: string; organizationId: string; displayName?: string }
  export type ProjectAction = "read" | "write" | "admin"
  export interface AuthContext {
    resolve(request: AuthRequestHints): Promise<AuthPrincipal>
    canAccessProject(principal: AuthPrincipal, projectId: string, action: ProjectAction): Promise<boolean>
    /** Stub helper: register project ownership for access checks */
    registerProject?(projectId: string, ownerUserId: string, organizationId: string): void
  }
  export class StubAuthContext implements AuthContext
  ```
- Consumes: none

- [ ] **Step 1: Write failing tests** for `StubAuthContext` — header `x-user-id: user-a` resolves to org `org-demo`; unknown user → throw; after `registerProject`, user-b denied write on user-a project; user-a allowed

- [ ] **Step 2: Run** `pnpm --filter @blocksync/auth-context test` — expect FAIL (package missing)

- [ ] **Step 3: Implement** `StubAuthContext` with in-memory map `projectId → { ownerUserId, organizationId }`; resolve via headers `x-user-id` / optional `x-organization-id` (default org-demo)

- [ ] **Step 4: Run tests** — PASS

- [ ] **Step 5: Commit** `feat(auth-context): add StubAuthContext for R1 persistence`

---

### Task 2: project-envelope package

**Files:**
- Create: `packages/project-envelope/package.json`
- Create: `packages/project-envelope/src/index.ts`
- Create: `packages/project-envelope/src/index.test.ts`

**Interfaces:**
- Consumes: `ProjectDocument` from `@blocksync/project-schema`
- Produces:
  ```typescript
  export const PROJECT_FORMAT = "blocksync.project/v1" as const
  export interface ProjectEnvelopeV1 {
    format: typeof PROJECT_FORMAT
    projectId: string
    organizationId: string
    title: string
    revision: number
    schemaVersion: number
    updatedAt: string
    updatedByUserId: string
    document: ProjectDocument
  }
  export function emptyDocument(): ProjectDocument
  export function assertEnvelope(value: unknown): ProjectEnvelopeV1
  export function fingerprintDocument(doc: ProjectDocument): string
  ```

- [ ] **Step 1: Failing tests** — `emptyDocument` validates with `validateProject`; `assertEnvelope` rejects wrong format; fingerprint stable for same doc

- [ ] **Step 2: Implement** types + helpers (fingerprint = sorted JSON stringify of targets/blocks/vars)

- [ ] **Step 3: Tests PASS; commit** `feat(project-envelope): blocksync.project/v1 wire format`

---

### Task 3: project-service ports + in-memory fake

**Files:**
- Create: `packages/project-service/package.json`
- Create: `packages/project-service/src/ports.ts`
- Create: `packages/project-service/src/service.ts`
- Create: `packages/project-service/src/errors.ts`
- Create: `packages/project-service/src/service.test.ts`

**Interfaces:**
- Consumes: `AuthContext`, `ProjectEnvelopeV1`, `validateProject`
- Produces:
  ```typescript
  export class StaleRevisionError extends Error { code = "STALE_REVISION" }
  export class SchemaInvalidError extends Error { code = "SCHEMA_INVALID"; issues: ValidationIssue[] }
  export class ForbiddenError extends Error { code = "FORBIDDEN" }
  export class NotFoundError extends Error { code = "NOT_FOUND" }

  export interface SaveDocumentInput {
    projectId: string
    baseRevision: number
    transactionId: string
    document: ProjectDocument
    hints: AuthRequestHints
  }

  export interface ProjectService {
    createProject(hints: AuthRequestHints, title: string): Promise<ProjectEnvelopeV1>
    listProjects(hints: AuthRequestHints): Promise<Array<{ projectId: string; title: string; revision: number }>>
    getProject(hints: AuthRequestHints, projectId: string): Promise<ProjectEnvelopeV1>
    saveDocument(input: SaveDocumentInput): Promise<ProjectEnvelopeV1>
    createSnapshot(hints: AuthRequestHints, projectId: string, reason: string): Promise<{ snapshotId: string; basedOnRevision: number }>
    listSnapshots(hints: AuthRequestHints, projectId: string): Promise<Array<{ snapshotId: string; basedOnRevision: number; reason: string }>>
    restoreSnapshot(hints: AuthRequestHints, projectId: string, snapshotId: string, baseRevision: number, transactionId: string): Promise<ProjectEnvelopeV1>
  }

  export interface ProjectRepository { /* create, get, list, saveRevision transactional, getByTransactionId */ }
  export interface SnapshotStore { /* put, get, list */ }
  ```

- [ ] **Step 1: Write failing acceptance-style unit tests** using in-memory repository fake:
  1. create → save edit → get matches fingerprint  
  2. save with `baseRevision: 0` after head=1 → `StaleRevisionError`, head unchanged  
  3. invalid document (broken next) → `SchemaInvalidError`, head unchanged  
  4. snapshot → edit → restore snapshot with current base → new revision equals snapshot fingerprint; old revisions still readable via repo helper  

- [ ] **Step 2: Implement service** with fakes in test file; real ports interfaces in `ports.ts`

- [ ] **Step 3: PASS; commit** `feat(project-service): revisioned save and snapshot restore use-cases`

---

### Task 4: SQLite + filesystem adapters

**Files:**
- Create: `packages/project-store-sqlite/src/index.ts`
- Create: `packages/project-store-sqlite/src/index.test.ts`
- Create: `packages/project-snapshots-fs/src/index.ts`
- Create: `packages/project-snapshots-fs/src/index.test.ts`
- Add dependency: `better-sqlite3`, `@types/better-sqlite3`

**Interfaces:**
- Consumes: ports from `project-service`
- Produces: `createSqliteProjectRepository(dbPath)`, `createFsSnapshotStore(rootDir)`

- [ ] **Step 1: Failing integration test** — temp dir DB; create/save/get across **new repository instance** (simulates restart)

- [ ] **Step 2: Implement schema migration v1 SQL** in open(); content-addressed files `snapshots/{hash}.json`

- [ ] **Step 3: PASS; commit** `feat: sqlite project repo and fs snapshot store`

---

### Task 5: HTTP server app

**Files:**
- Create: `apps/r1-persist-server/package.json`
- Create: `apps/r1-persist-server/src/server.ts`
- Create: `apps/r1-persist-server/src/server.test.ts`
- Create: `apps/r1-persist-server/src/main.ts`
- Modify: root `package.json` scripts `r1:persist-server`, `r1:persist-test`

**Interfaces:**
- Maps HTTP ↔ `ProjectService` as in design §8
- Headers: `x-user-id` for stub auth

- [ ] **Step 1: Failing HTTP test** with `startServer({ dataDir })` — POST create, PUT save, GET; 409/422 bodies

- [ ] **Step 2: Implement Hono (or node:http) routes**; map errors to status codes

- [ ] **Step 3: PASS; commit** `feat(r1-persist-server): HTTP API for project persistence`

---

### Task 6: Autosave client + debounce

**Files:**
- Create: `packages/project-autosave/src/index.ts`
- Create: `packages/project-autosave/src/index.test.ts`

**Interfaces:**
```typescript
export type SaveState = "clean" | "dirty" | "saving" | "error" | "conflict"
export interface AutosaveController {
  getState(): SaveState
  notifyLocalEdit(document: ProjectDocument): void
  /** Test helper: flush debounce immediately */
  flush(): Promise<void>
  dispose(): void
}
export function createAutosaveController(opts: {
  debounceMs: number
  save: (args: { baseRevision: number; transactionId: string; document: ProjectDocument }) => Promise<{ revision: number }>
  getBaseRevision: () => number
  onState?: (s: SaveState) => void
  retryDelaysMs?: number[]
}): AutosaveController
```

- [ ] **Step 1: Fake timer tests** — edit → still dirty before debounce; after debounce save called once; fail then retry; 409 → `conflict` no further retry

- [ ] **Step 2: Implement**; commit `feat(project-autosave): debounce autosave state machine`

---

### Task 7: End-to-end acceptance (restart)

**Files:**
- Create: `apps/r1-persist-demo/src/persistence.acceptance.test.ts`

- [ ] **Step 1: Write the four acceptance tests** from design §9 against real server + real sqlite dir:
  1. create → apply_sprite_blocks edit → autosave flush → **stop server** → start → get identical fingerprint/revision  
  2. stale revision 409; head unchanged  
  3. schema invalid 422; head unchanged  
  4. snapshot → divergent save → restore → fingerprint equals snapshot; revision increased  

- [ ] **Step 2: Run** `pnpm --filter @blocksync/r1-persist-demo test` — PASS

- [ ] **Step 3: Commit** `test(r1): acceptance for persistence slice`

---

### Task 8: Docs + CI hook

**Files:**
- Create: `docs/r1/PERSISTENCE.md` (how to run server, data dir, stub headers)
- Modify: `.github/workflows/gate0.yml` **or** add `r1-persist.yml` that runs `pnpm --filter @blocksync/r1-persist-demo test` (do not fail Gate 0 job on R1 — separate workflow)
- Modify: root README if present; else skip

- [ ] **Step 1: Write docs + CI workflow**
- [ ] **Step 2: Commit** `docs(r1): persistence slice runbook and CI`

---

## Spec coverage self-check

| Design requirement | Task |
|---|---|
| Create/list/get | 3, 5, 7 |
| Revision optimistic concurrency | 3, 5, 7 |
| Debounce autosave | 6, 7 |
| Immutable snapshots + restore as new revision | 3, 4, 7 |
| Save failure retry + unsaved/error state | 6 |
| Process restart restore | 4, 7 |
| Server project-schema validation | 3, 5, 7 |
| Stub user/org access | 1, 3, 7 |
| AuthContext swappable | 1 |
| Scratch-connectable envelope | 2 |
| No Scratch UI / Google OAuth | Global constraints |

## Placeholder scan

None intended. If an implementer hits Node API choice for SQLite, prefer `better-sqlite3` as stated in Tech Stack.

---

## Execution gate

**Do not start Tasks until the design doc is approved in review.** After approval, execute with subagent-driven-development or executing-plans.
