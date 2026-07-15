# Release 1 Slice — Project Persistence Design

> **Date:** 2026-07-15
> **Status:** Approved for implementation (Approach A + P1/P2 revisions)
> **Revision:** sync TX contract, request schemaVersion, requestHash (post-`254cefa`)
> **Prerequisite:** Gate 0 Technical Go @ `4a14e05`; SB3 isolate timeout @ `ae645a0` (independent)
> **Spec anchors:** §11–12, §44–45, §55

## 1. Goal

Server-authoritative project persistence for one authenticated principal (stub identity):

1. Create / list / get projects (**membership-scoped only**)
2. Save with revision CAS + **idempotent `transactionId`**
3. Debounced autosave with **generation / pending document** semantics
4. Immutable snapshots + restore as **new revision**
5. Unsaved / retry / conflict client states
6. Process restart restores head from durable store
7. Server-side `project-schema` before commit

Out of scope: Scratch Editor UI, Google OAuth, Yjs multiplayer, SB3 UX, classes/teacher.

**Approach A (SQLite + FS behind ports): approved** for this slice. Postgres stays a future adapter. Repository **contract tests** and SQLite-specific SQL isolation are mandatory (Approach B deferred).

## 2. Architecture

```text
┌─────────────────────────────┐
│  r1-persist-demo / tests    │  edit ops + autosave + child-process restart
└──────────────┬──────────────┘
               │ HTTP (Hono on Node)
┌──────────────▼──────────────┐
│  @blocksync/project-service │
│  - AuthContext (identity)   │
│  - ProjectAccessPolicy      │  ← durable ownership/members from SQLite
│  - validateProject + hash   │
│  - idempotent save + CAS    │
└───┬─────────────┬───────────┘
    │             │
┌───▼──────────┐ ┌▼──────────────────┐
│ ProjectRepo  │ │ SnapshotStore     │
│ (SQLite)     │ │ (atomic FS files) │
└──────────────┘ └───────────────────┘
```

| Unit | Role |
|---|---|
| `packages/auth-context` | **Identity only** (`resolve`) |
| `packages/project-envelope` | `blocksync.project/v1` + **full canonicalization / content hash** |
| `packages/project-service` | Use-cases + `ProjectAccessPolicy` + ports |
| `packages/project-store-sqlite` | SQLite adapter (**only** SQLite SQL here) |
| `packages/project-snapshots-fs` | Atomic snapshot files |
| `apps/r1-persist-server` | Hono HTTP |
| `apps/r1-persist-demo` | Acceptance tests |

**Pinned stack for this plan:** `better-sqlite3` **^12.11.1+** (Node 24 ABI prebuilds; not `node:sqlite`); **Hono** on Node (not raw `node:http`).

### 2.1 better-sqlite3 transaction contract

`better-sqlite3` transaction callbacks must finish **synchronously**. Do not return a `Promise` from the callback.

```typescript
export interface ProjectRepository {
  /** Sync only — no await inside fn. */
  withTransaction<T>(fn: (tx: ProjectRepositoryTx) => T): T;
}
```

Service rules:

1. `await auth.resolve(...)` **before** opening a DB transaction.
2. Inside `withTransaction`, perform ACL check, idempotent lookup, CAS, and revision insert **with no `await`**.
3. Public service methods may return `Promise` (resolve auth, FS snapshot I/O), but DB work inside the callback stays sync.
4. Contract tests include: thrown error inside the callback **rolls back** (no partial head/revision writes).

## 3. Identity vs authorization

### 3.1 AuthContext — identity only

```typescript
export interface AuthRequestHints {
  headers: Record<string, string | undefined>;
}
export interface AuthPrincipal {
  userId: string;
  organizationId: string;
  displayName?: string;
}
export interface AuthContext {
  /** Authenticate caller. Never performs project ACL. */
  resolve(request: AuthRequestHints): Promise<AuthPrincipal>;
}
```

`StubAuthContext`: maps `x-user-id` → fixed principals (`user-a` / `user-b` in `org-demo`). No in-memory project registration. No `canAccessProject`.

Later: `GoogleAuthContext` implements the **same** `resolve` surface only.

### 3.2 Durable access — ProjectAccessPolicy

Authorization reads **only** persisted rows (`projects.owner_user_id`, `project_members`), typically via the open sync transaction:

```typescript
export type ProjectAction = "read" | "write" | "admin";

export interface ProjectAccessPolicy {
  /** Sync — used inside withTransaction when backed by SQLite. */
  assertCan(
    principal: AuthPrincipal,
    projectId: string,
    action: ProjectAction,
    tx: ProjectRepositoryTx,
  ): void; // throws ForbiddenError / NotFoundError
}
```

Rules:

- Same organization is **not** enough.
- **List:** return only projects where principal is owner or `project_members` row exists.
- **Get / save / snapshot / restore:** require membership (or owner) for the action; non-members → **404** for existence hiding on get-by-id, even if same org.
- Create: insert `projects` + owner membership **in one DB transaction**; no separate memory registry.
- Restart: ACL comes from SQLite; no warm-up Map.

## 4. Envelope + canonicalization

```typescript
export interface ProjectEnvelopeV1 {
  format: "blocksync.project/v1";
  projectId: string;
  organizationId: string;
  title: string;
  revision: number;
  schemaVersion: number; // MUST equal document.schemaVersion
  contentHash: string;   // sha256 of canonicalize(document)
  updatedAt: string;     // server clock
  updatedByUserId: string;
  document: ProjectDocument;
}
```

### 4.1 Canonicalization (completeness)

`canonicalizeDocument(doc)` produces a **deterministic UTF-8 JSON** covering the **entire** `ProjectDocument`:

- `schemaVersion`
- `extensions` (sorted)
- `meta` (keys sorted recursively)
- `targets[]` sorted by `id`, each including: `id`, `name`, `isStage`, `blocks` (keys sorted; each block fields sorted), `variables`, `lists`, `broadcasts`

`contentHash = sha256(canonicalizeDocument(doc))`.

Acceptance fixtures **must** include: multiple sprites, variables, lists, broadcasts, extensions, Japanese names/strings. Equality checks use `contentHash` **or** deep-equal of parsed canonicalize output — **not** a targets/blocks/vars-only fingerprint.

### 4.2 schemaVersion rule (client-supplied)

Save / restore inputs carry an explicit **client `schemaVersion`** (spec §11.2). The server does **not** invent it solely from `document.schemaVersion` for the mismatch check.

On every save:

- If `schemaVersion !== document.schemaVersion` → `422 SCHEMA_VERSION_MISMATCH`
- `validateProject(document)` must succeed
- Server-written envelope uses the (matching) `schemaVersion`

### 4.3 contentHash vs requestHash

| Hash | Covers | Use |
|---|---|---|
| `contentHash` | Canonical full `document` only | Envelope field; snapshot payload identity; restart equality |
| `requestHash` | Idempotency payload: `op`, `schemaVersion`, `contentHash` (and any other fields in the logical save request that must not drift) | Stored with `client_transaction_id`; replay/mismatch |

Same `transactionId` with same document but different `schemaVersion` or operation kind → **`TRANSACTION_PAYLOAD_MISMATCH`**.

Example requestHash material (canonical JSON keys sorted as implemented, then sha256):

```json
{ "contentHash": "<hex>", "op": "save_document", "schemaVersion": 1 }
```

Restore:

```json
{ "contentHash": "<hex>", "op": "restore", "schemaVersion": 1, "snapshotId": "<id>" }
```

Restore revisions also set `envelope.revisionMeta = { op: "restore", snapshotId }`.

## 5. Save algorithm (idempotent + CAS)

HTTP / service input:

```typescript
{
  baseRevision: number;
  transactionId: string;
  schemaVersion: number;
  document: ProjectDocument;
}
```

Flow:

1. `principal = await auth.resolve(...)` — **outside** any DB transaction.
2. Validate document structure; compute `contentHash`; if `schemaVersion !== document.schemaVersion` → reject; compute `requestHash`.
3. Open **one sync** `withTransaction`:
   1. `access.assertCan(principal, projectId, "write", tx)`.
   2. Lookup revision by `(project_id, client_transaction_id)`:
      - Found and `request_hash === requestHash` → return stored envelope (idempotent success).
      - Found and hash differs → `TRANSACTION_PAYLOAD_MISMATCH`; no mutation.
   3. Read head revision.
   4. If `baseRevision !== head` → `STALE_REVISION`.
   5. CAS update `head_revision` where `head_revision = baseRevision`; 0 rows → `STALE_REVISION`.
   6. Insert revision row (`content_hash`, `request_hash`, `client_transaction_id`, envelope JSON).
4. Return new envelope.

**Concurrency test (required):** two saves, same `baseRevision`, different `transactionId`/payloads → exactly one success, one `STALE_REVISION`; head advances by 1.

**Rollback test (required):** error thrown mid-callback leaves head and revisions unchanged.

## 6. Snapshots (P2)

**This slice: explicit snapshot API only.** No autosave-threshold automatic snapshots (deferred). Reasons still include `manual` and `pre_restore`.

Write path:

1. Canonicalize + hash head document; re-validate schema.
2. Persist **`canonicalizeDocument(document)` UTF-8 bytes** (not `JSON.stringify(document)`). `putAtomic` requires `sha256(bytes) === contentHash` before write.
3. Write `snapshots/{contentHash}.{uniqueSuffix}.tmp` → `fsync` → atomic `rename` to `{contentHash}.json`.
4. If final `{contentHash}.json` already exists: verify its content hash matches; **discard** the temp file; reuse the existing file. Same head may create multiple snapshot rows sharing one file.
5. Insert DB row referencing `storage_key` / hash for **`(project_id, snapshot_id)`**.
6. If DB insert fails after file exists: leave orphan file; **startup** calls `gcOrphans(listAllSnapshotStorageKeys())`. Never delete a file still referenced by DB.

**Restore:**

1. Lookup snapshot by **`(projectId, snapshotId)` only** — never by `snapshotId` alone (prevents BOLA across projects).
2. Load file; verify `sha256(file) === content_hash` in DB.
3. Parse document; `validateProject` + client `schemaVersion` rules on the ensuing save.
4. Call normal `saveDocument` with caller’s `baseRevision`, `schemaVersion`, and new `transactionId`.

**BOLA test (required):** Project B’s `snapshotId` cannot restore into Project A.

## 7. Autosave client — generation / pending

```typescript
type SaveState = "clean" | "dirty" | "saving" | "error" | "conflict";
```

Invariants:

1. Each local edit bumps `generation` and sets `pendingDocument`.
2. While `saving`, further edits update `pendingDocument` / `generation` but **do not** clear dirty.
3. On save **success**: if `response matched the generation that was sent`, advance `baseRevision` from response; if `pendingDocument` is newer (`generation > sentGeneration`), stay/set `dirty` and schedule another debounce; else `clean`.
4. **Never** mark `clean` if a newer pending document exists.
5. Retries of the **same logical save** reuse the same `transactionId` + same serialized payload (including `schemaVersion`); a new logical save (new generation sent) gets a **new** `transactionId`.
6. `dispose()`: clear debounce timer, retry timers, and callbacks; no further network.

Debounce default 800ms; retry delays `[500, 1000, 2000]` then stay `error`.

## 8. API

| Method | Path | AuthZ |
|---|---|---|
| `POST` | `/v1/projects` | authenticated |
| `GET` | `/v1/projects` | **member projects only** |
| `GET` | `/v1/projects/:id` | member |
| `PUT` | `/v1/projects/:id/document` | member write; body `{ baseRevision, transactionId, schemaVersion, document }` |
| `POST` | `/v1/projects/:id/snapshots` | member write; explicit only |
| `GET` | `/v1/projects/:id/snapshots` | member |
| `POST` | `/v1/projects/:id/restore` | member write; body includes `snapshotId` scoped to `:id` |

Errors: `401`, `403`/`404`, `409 STALE_REVISION`, `409 TRANSACTION_PAYLOAD_MISMATCH`, `422 SCHEMA_INVALID`, `422 SCHEMA_VERSION_MISMATCH`.

## 9. Acceptance tests (must pass)

Fixture document includes multi-sprite, variables, lists, broadcasts, extensions, Japanese strings.

1. **Create → edit → autosave → child-process restart → get** — same `revision` + `contentHash` (full canonicalization). Server killed **after** save ACK; same `R1_DATA_DIR`.
2. **Stale revision** → 409; head hash unchanged.
3. **Invalid structure** → 422; head unchanged.
4. **Snapshot → divergent save → restore** → new revision; `contentHash` equals snapshot; prior revisions remain.
5. **Idempotent replay** — successful save, re-PUT same `transactionId` + same requestHash material → same envelope; different document / schemaVersion / op → mismatch error.
6. **Concurrent CAS** — two same-base saves → one success, one stale.
7. **ACL** — same-org non-member denied list/get/save/snapshot/restore.
8. **Autosave generation** — edit during in-flight save remains dirty and is saved afterward with new base.
9. **dispose** — no timers after dispose (fake-timer assertion).
10. **TX rollback** — forced error mid-save leaves DB unchanged.
11. **BOLA restore** — cannot restore Project B snapshot into Project A.

## 10. Non-goals

Google GIS body, Scratch GUI, Yjs, automatic snapshot thresholds, Postgres production ops.

## 11. Review checklist

- [x] Approach A approved
- [x] Auth = identity only; ACL from durable membership
- [x] Sync SQLite TX (no Promise in callback); auth resolve before TX
- [x] Client `schemaVersion` on save; requestHash ≠ contentHash
- [x] Idempotent save order + CAS concurrency + rollback tests
- [x] Autosave generation / pending document
- [x] Full document canonicalization + rich fixture + child-process restart
- [x] Snapshot atomic write (unique temp) + orphan GC; restore `(projectId, snapshotId)` + BOLA
- [x] Stack pinned: better-sqlite3 + Hono; snapshots explicit-only
