# Release 1 Slice — Project Persistence Design

> **Date:** 2026-07-15  
> **Status:** Draft for review (do not implement until approved)  
> **Prerequisite:** Gate 0 Technical Go @ `4a14e05`; SB3 isolate timeout test @ `ae645a0` (independent, does not alter Gate 0 verdict)  
> **Spec anchors:** §11–12, §44–45, §55 (persisted project + autosave + snapshot; no Scratch UI / Google OAuth in this slice)

## 1. Goal

Deliver a **server-authoritative project persistence slice** that a single user (stub auth) can:

1. Create / list / get projects  
2. Save with **revision-based optimistic concurrency**  
3. Autosave with debounce  
4. Create **immutable snapshots** and restore via a **new revision** (never rewrite history)  
5. Show unsaved / retry state on failure  
6. Survive **process restart** and restore the last accepted revision  
7. Reject invalid structure via **server-side `project-schema`** before commit  

Out of scope for this slice: Scratch Editor UI, Google OAuth, real multi-user collab (Yjs), SB3 import/export UX, teacher/class entities.

## 2. Approaches considered

| Approach | Idea | Pros | Cons |
|---|---|---|---|
| **A. SQLite + file blobs behind repository ports (recommended)** | Local SQLite for projects/revisions/memberships; snapshot payloads as content-addressed files (or BLOB). Swap later to Postgres + object storage. | Fits Gate 0 monorepo speed; process-restart testable; ports match AuthContext swappability | Not production multi-node; need clear “ephemeral store” labeling |
| **B. PostgreSQL + object storage from day one** | Matches long-term §11 exactly | Future-proof storage | Heavy ops for first slice; slows iteration |
| **C. Flat JSON files only** | One folder per project | Simple | Weak revision locking, indexing, membership queries |

**Recommendation: A.** Repository interfaces (`ProjectRepository`, `SnapshotStore`) hide SQLite. Auth is `AuthContext` with `StubAuthContext` now and `GoogleAuthContext` later. Document format stays scratch-connectable (`ProjectDocument` + envelope).

## 3. Architecture

```text
┌─────────────────────────────┐
│  r1-persist-demo / tests    │  minimal edit ops + autosave client
└──────────────┬──────────────┘
               │ HTTP or in-process API
┌──────────────▼──────────────┐
│  @blocksync/project-service │  use-cases: create/list/get/save/snapshot/restore
│  - AuthContext              │
│  - validateProject()        │
│  - revision compare         │
└───────┬───────────┬─────────┘
        │           │
┌───────▼──────┐ ┌──▼──────────────────┐
│ ProjectRepo  │ │ SnapshotStore       │
│ (SQLite)     │ │ (files under data/) │
└──────────────┘ └─────────────────────┘
        ▲
        │ uses
┌───────┴────────────────────┐
│ @blocksync/project-schema  │  structure gate (unchanged Gate 0)
│ @blocksync/auth-context    │  actor/org identity + access checks
└────────────────────────────┘
```

### Packages / apps (proposed)

| Unit | Role |
|---|---|
| `packages/auth-context` | `AuthContext` interface + `StubAuthContext` |
| `packages/project-envelope` | Wire format: envelope + document (no I/O) |
| `packages/project-service` | Domain use-cases + ports (pure enough to test) |
| `packages/project-store-sqlite` | SQLite adapter for ProjectRepo |
| `packages/project-snapshots-fs` | Filesystem snapshot adapter |
| `apps/r1-persist-server` | Thin HTTP server (Node) mounting service |
| `apps/r1-persist-demo` | Vitest-driven client: edit → autosave → restart |

Gate 0 packages stay untouched except optional dependency edges (`project-schema` reused).

## 4. AuthContext (swappable)

```typescript
export interface AuthPrincipal {
  userId: string;
  organizationId: string;
  displayName?: string;
}

export interface AuthContext {
  /** Resolve caller from request (headers/session). Never trust body IDs alone. */
  resolve(request: AuthRequestHints): Promise<AuthPrincipal>;
  /** Server-side membership / role check for a project. */
  canAccessProject(
    principal: AuthPrincipal,
    projectId: string,
    action: "read" | "write" | "admin",
  ): Promise<boolean>;
}
```

`StubAuthContext`:

- Fixed principals `user-a` / `user-b` in org `org-demo`  
- Project ownership recorded at create time as `ownerUserId` + `organizationId`  
- Access: same org + (owner or listed member); default create → owner-only  
- No Google tokens; injectable clock for tests  

Later: `GoogleAuthContext` wraps `google-identity` and session store; same interface.

## 5. Project save format (Scratch-connectable)

```typescript
/** Wire + storage format for this slice */
export interface ProjectEnvelopeV1 {
  format: "blocksync.project/v1";
  projectId: string;
  organizationId: string;
  title: string;
  revision: number;          // server-assigned monotonic per project
  schemaVersion: number;     // mirrors document.schemaVersion
  updatedAt: string;         // ISO, server clock only
  updatedByUserId: string;
  document: ProjectDocument; // @blocksync/project-schema
}
```

Rules:

- **Authority document** = last accepted envelope’s `document`  
- Scratch VM / GUI later load via adapter: `document` → Scratch JSON / SB3 (R1 later slice uses `sb3-tools`)  
- Envelope never embeds OAuth tokens, AI history, or class metadata  
- `@experimental` until R1 freeze  

Minimal **test edit op** (not Scratch UI):

```typescript
interface ApplyBlocksEdit {
  type: "apply_sprite_blocks";
  spriteId: string;
  name?: string;
  blocks: Record<string, ScratchBlock>;
  variables?: Record<string, [string, string | number]>;
}
```

Client builds a candidate `ProjectDocument`, then `save({ baseRevision, document })`. Server validates full document, not only the patch.

## 6. Persistence model

### 6.1 Tables (SQLite / future Postgres)

- `organizations(id, name)`  
- `users(id, organization_id, display_name)`  
- `projects(id, organization_id, owner_user_id, title, head_revision, created_at, updated_at)`  
- `project_members(project_id, user_id, role)`  
- `project_revisions(project_id, revision, envelope_json, content_hash, actor_user_id, created_at, client_transaction_id UNIQUE)`  
- `project_snapshots(id, project_id, based_on_revision, reason, content_hash, storage_key, created_by, created_at)`  

`client_transaction_id` unique → idempotent retries.

### 6.2 Save algorithm

1. Resolve `AuthPrincipal`; deny if `!canAccessProject(..., "write")`  
2. Load project head revision `H`  
3. If `baseRevision !== H` → **409 CONFLICT** (`STALE_REVISION`); authority unchanged  
4. `validateProject(document)`; if fail → **422** (`SCHEMA_INVALID`); authority unchanged  
5. Assign `revision = H + 1`, write revision row + update `projects.head_revision` in one transaction  
6. Return new envelope  

### 6.3 Snapshots

- Immutable: storage object is write-once; DB row never updates payload  
- Create on: explicit API, N successful saves, or restore  
- Fields: `based_on_revision`, `reason` (`manual` | `autosave_threshold` | `pre_restore`), `content_hash`  
- **Restore** = `save` of snapshot’s document with current `baseRevision`, plus audit reason `restore` (new revision; history preserved)  

### 6.4 Process restart

- Server data directory configurable (`R1_DATA_DIR`)  
- On boot, reopen SQLite; clients `GET /projects/:id` → head envelope  
- Integration test: save → kill server process → start → get same revision/document  

## 7. Autosave client (minimal)

State machine (display + behavior):

| State | Meaning |
|---|---|
| `clean` | Local matches last accepted server revision |
| `dirty` | Local edits not yet accepted |
| `saving` | Request in flight |
| `error` | Last save failed (network/5xx); retry scheduled |
| `conflict` | 409; must reload or merge (slice: reload head + mark dirty discarded or rebased by test helper) |

Behavior:

- Debounce **800ms** default (configurable) after local edit  
- On failure: exponential backoff retries (e.g. 0.5s, 1s, 2s; max 3) then stay `error` with unsaved flag  
- On 409: stop auto-retry; surface conflict  
- Idempotent `transactionId` per save attempt (UUID); retry same id  

No React UI required: state exposed as object for tests/demo logging.

## 8. API sketch (HTTP)

All mutating routes require AuthContext; project/org from server records, not trusted blindly from body.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/v1/projects` | create empty validated document |
| `GET` | `/v1/projects` | list for principal’s org |
| `GET` | `/v1/projects/:id` | head envelope |
| `PUT` | `/v1/projects/:id/document` | body: `{ baseRevision, transactionId, document }` |
| `POST` | `/v1/projects/:id/snapshots` | `{ reason? }` from current head |
| `GET` | `/v1/projects/:id/snapshots` | list metadata |
| `POST` | `/v1/projects/:id/restore` | `{ snapshotId, baseRevision, transactionId }` |

Errors: `401`, `403`, `404`, `409 STALE_REVISION`, `422 SCHEMA_INVALID`, `429` (optional later).

## 9. Acceptance tests (must pass)

1. **Create → edit → autosave → restart → restore** same head revision + document fingerprint  
2. **Stale revision rejected**; head unchanged after 409  
3. **Invalid structure rejected**; head unchanged  
4. **Snapshot → restore** creates new revision equal to snapshot document; prior revisions remain  

Plus: ownership isolation (user-a cannot write user-b’s project).

## 10. Non-goals / deferred

- Google GIS binding (interface only)  
- Scratch GUI / VM binding beyond format readiness  
- Yjs multiplayer  
- Full §44 entity set (classes, AI, audit hash chain)  
- Multi-region / production Postgres ops  

## 11. Risks

| Risk | Mitigation |
|---|---|
| SQLite vs future Postgres drift | Narrow SQL dialect; repository tests against interface |
| Full-document saves too large | Acceptable for R1 slice; later switch to operation log (§11.2) |
| Autosave race with manual save | Serialize client saves (queue); server remains authoritative |

## 12. Review checklist

- [ ] Approach A (SQLite ports) approved vs B/C  
- [ ] Envelope format `blocksync.project/v1` approved  
- [ ] AuthContext surface approved  
- [ ] Acceptance tests sufficient  
- [ ] Ready for implementation plan execution after approval  
