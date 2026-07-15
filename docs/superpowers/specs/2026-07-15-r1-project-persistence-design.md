# Release 1 Slice — Project Persistence Design

> **Date:** 2026-07-15  
> **Status:** Revised draft for re-review (do not implement until approved)  
> **Revision:** addresses review P1/P2 on `7dbd33a`  
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

**Pinned stack for this plan:** `better-sqlite3` (not `node:sqlite`); **Hono** on Node (not raw `node:http`).

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

Authorization reads **only** persisted rows (`projects.owner_user_id`, `project_members`):

```typescript
export type ProjectAction = "read" | "write" | "admin";

export interface ProjectAccessPolicy {
  assertCan(
    principal: AuthPrincipal,
    projectId: string,
    action: ProjectAction,
  ): Promise<void>; // throws ForbiddenError / NotFoundError
}
```

Rules:

- Same organization is **not** enough.  
- **List:** return only projects where principal is owner or `project_members` row exists.  
- **Get / save / snapshot / restore:** require membership (or owner) for the action; non-members → **404** (or 403; pick **404** for existence hiding on get-by-id) if not a member, even if same org.  
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

### 4.2 schemaVersion rule

On every save / snapshot write / restore:

- Reject if `envelope.schemaVersion !== document.schemaVersion` → `422 SCHEMA_VERSION_MISMATCH`  
- `validateProject(document)` must succeed  

## 5. Save algorithm (idempotent + CAS)

Inputs: `projectId`, `baseRevision`, `transactionId`, `document`.

Inside **one SQLite transaction**:

1. Resolve principal; `assertCan(..., "write")`.  
2. Compute `payloadHash = contentHash(document)`; validate schema + schemaVersion.  
3. **Lookup** `project_revisions` by `(project_id, client_transaction_id)`:  
   - If found and `content_hash === payloadHash` → return stored envelope (**idempotent success**).  
   - If found and hash differs → **409** `TRANSACTION_PAYLOAD_MISMATCH` (or 422); no mutation.  
4. Read `head_revision` with row lock (`SELECT …`).  
5. If `baseRevision !== head` → **409** `STALE_REVISION`.  
6. CAS: `UPDATE projects SET head_revision = head+1, … WHERE id=? AND head_revision=baseRevision`; if 0 rows → `STALE_REVISION`.  
7. Insert revision row with new revision, envelope JSON, hashes, `client_transaction_id`.  
8. Commit; return new envelope.  

**Concurrency test (required):** two parallel saves, same `baseRevision`, different `transactionId`/payloads → exactly one `200`, one `409 STALE_REVISION`; head advances by 1.

## 6. Snapshots (P2)

**This slice: explicit snapshot API only.** No autosave-threshold automatic snapshots (deferred). Reasons still include `manual` and `pre_restore`.

Write path:

1. Canonicalize + hash head document; re-validate schema.  
2. Write `snapshots/{contentHash}.json.tmp` → `fsync` → atomic `rename` to `{contentHash}.json`.  
3. Insert DB row referencing `storage_key` / hash.  
4. If DB insert fails after file exists: leave orphan file; **startup GC** deletes unreferenced snapshot files (orphan policy). Never delete a file still referenced by DB.

**Restore:**

1. Load snapshot file; verify `sha256(file) === content_hash` in DB.  
2. Parse document; `validateProject` + schemaVersion rules.  
3. Call normal `saveDocument` with caller’s `baseRevision` + new `transactionId` (reason tagged `restore` in revision meta if we store it).  

## 7. Autosave client — generation / pending

```typescript
type SaveState = "clean" | "dirty" | "saving" | "error" | "conflict";
```

Invariants:

1. Each local edit bumps `generation` and sets `pendingDocument`.  
2. While `saving`, further edits update `pendingDocument` / `generation` but **do not** clear dirty.  
3. On save **success**: if `response matched the generation that was sent`, advance `baseRevision` from response; if `pendingDocument` is newer (`generation > sentGeneration`), stay/set `dirty` and schedule another debounce; else `clean`.  
4. **Never** mark `clean` if a newer pending document exists.  
5. Retries of the **same logical save** reuse the same `transactionId` + same serialized payload; a new logical save (new generation sent) gets a **new** `transactionId`.  
6. `dispose()`: clear debounce timer, retry timers, and callbacks; no further network.

Debounce default 800ms; retry delays `[500, 1000, 2000]` then stay `error`.

## 8. API

| Method | Path | AuthZ |
|---|---|---|
| `POST` | `/v1/projects` | authenticated |
| `GET` | `/v1/projects` | **member projects only** |
| `GET` | `/v1/projects/:id` | member |
| `PUT` | `/v1/projects/:id/document` | member write; body `{ baseRevision, transactionId, document }` |
| `POST` | `/v1/projects/:id/snapshots` | member write; explicit only |
| `GET` | `/v1/projects/:id/snapshots` | member |
| `POST` | `/v1/projects/:id/restore` | member write |

Errors: `401`, `403`/`404`, `409 STALE_REVISION`, `409 TRANSACTION_PAYLOAD_MISMATCH`, `422 SCHEMA_INVALID`, `422 SCHEMA_VERSION_MISMATCH`.

## 9. Acceptance tests (must pass)

Fixture document includes multi-sprite, variables, lists, broadcasts, extensions, Japanese strings.

1. **Create → edit → autosave → child-process restart → get** — same `revision` + `contentHash` (full canonicalization). Server killed **after** save ACK; same `R1_DATA_DIR`.  
2. **Stale revision** → 409; head hash unchanged.  
3. **Invalid structure** → 422; head unchanged.  
4. **Snapshot → divergent save → restore** → new revision; `contentHash` equals snapshot; prior revisions remain.  
5. **Idempotent replay** — successful save, re-PUT same `transactionId`+payload → same envelope; different payload same id → mismatch error.  
6. **Concurrent CAS** — two same-base saves → one success, one stale.  
7. **ACL** — same-org non-member denied list/get/save/snapshot/restore.  
8. **Autosave generation** — edit during in-flight save remains dirty and is saved afterward with new base.  
9. **dispose** — no timers after dispose (fake-timer assertion).

## 10. Non-goals

Google GIS body, Scratch GUI, Yjs, automatic snapshot thresholds, Postgres production ops.

## 11. Review checklist (re-review)

- [x] Approach A approved  
- [ ] Auth = identity only; ACL from durable membership  
- [ ] Idempotent save order + CAS concurrency test  
- [ ] Autosave generation / pending document  
- [ ] Full document canonicalization + rich fixture + child-process restart  
- [ ] Snapshot atomic write + orphan GC; restore re-validate; schemaVersion equality  
- [ ] Stack pinned: better-sqlite3 + Hono; snapshots explicit-only  
