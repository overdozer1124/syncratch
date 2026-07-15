# R1 Project Persistence Runbook

Experimental slice behind repository ports. Not Gate 0-gated.

## Stack

- **Identity:** `@blocksync/auth-context` (`StubAuthContext`, `x-user-id`)
- **ACL:** durable SQLite `projects` / `project_members` via `ProjectAccessPolicy`
- **SQLite:** `better-sqlite3` **^12.11.1+** (Node 24 prebuilds). Transaction callbacks are **synchronous only**.
- **HTTP:** Hono on `@hono/node-server`
- **Snapshots:** filesystem under `R1_DATA_DIR/snapshots`, unique `*.tmp` then atomic rename

## Data directory

```bash
export R1_DATA_DIR=./apps/r1-persist-server/data
pnpm --filter @blocksync/r1-persist-server start
```

Layout:

- `projects.sqlite` — projects, members, revisions, snapshot metadata
- `snapshots/{contentHash}.json` — immutable payloads

Orphan policy: on process startup, `bootstrapPersistRuntime` calls
`snapshots.gcOrphans(repo.listAllSnapshotStorageKeys())` to delete unreferenced
`.json` snapshot files and leftover `.tmp` files.

## Auth headers (stub)

| Header | Required | Notes |
|---|---|---|
| `x-user-id` | yes | `user-a` or `user-b` |
| `x-organization-id` | no | defaults to `org-demo`; mismatch rejects |

Same-org users who are not members cannot list/get/save/snapshot/restore.

## Save body

```json
{
  "baseRevision": 0,
  "transactionId": "uuid",
  "schemaVersion": 1,
  "document": { "schemaVersion": 1, "targets": [], "extensions": [] }
}
```

- `schemaVersion` must equal `document.schemaVersion`
- Idempotency uses `requestHash` over `{ op, schemaVersion, contentHash }`
- `contentHash` is the full-document canonicalize hash only

## Sync transaction rules

1. `await auth.resolve` **outside** the DB transaction
2. `repo.withTransaction(tx => { ... })` must not `await`
3. ACL, transactionId lookup, CAS, and revision insert run in that single sync TX

## Snapshot blob bytes

Snapshot files store `canonicalizeDocument(document)` UTF-8 bytes. The
filename/`contentHash` is `sha256` of those same bytes. `putAtomic` rejects
writes where `sha256(bytes) !== contentHash`.

## Restore requestHash

Restore commits use `requestHash({ op: "restore", schemaVersion, contentHash, snapshotId })`
and set `envelope.revisionMeta = { op: "restore", snapshotId }`.

Idempotent restore looks up `(projectId, transactionId)` **before** reading the snapshot
blob (using `meta.contentHash` for the hash). A successful restore can therefore be
replayed even if the blob file was deleted afterward.

## Tests

```bash
pnpm r1:persist:typecheck
pnpm r1:persist:test
```

CI workflow: `.github/workflows/r1-persist.yml` (typecheck apps, then tests; separate from Gate 0).
