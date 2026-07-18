# R1 Workspace Directory Repositories Design

**Date:** 2026-07-18  
**Status:** Draft (awaiting written-spec review)  
**Predecessor:** [R1 Legacy Organization/User Backfill](2026-07-18-r1-legacy-organization-user-backfill-design.md)  
**Roadmap:** [R1 Workspace Roster Access Plan, Phase 3 Task 4](../plans/2026-07-16-r1-workspace-roster-access-plan.md) (thin slice)

## 1. Goal

Add a single `WorkspaceDirectoryRepository` port in `@blocksync/workspace-directory`
and a SQLite adapter in `@blocksync/project-store-sqlite`, wired through
`openSqliteStore()` as `directoryRepo`.

This thin slice covers **identity and membership** tables only: read existing
v5-backfilled rows, and perform **minimal writes** under
`workspace_directory_revisions` CAS. It does not implement the full roadmap
Task 4 surface (claims, attendance uniqueness, last-owner protection).

## 2. Non-goals

This slice does not:

- create claim, setup-secret, or rate-limit tables;
- implement school / academic year / grade / class / enrollment /
  staff assignment / roster import repositories;
- write `audit_events`;
- enforce last System Owner or last Workspace Owner removal rules;
- enforce attendance-number uniqueness (no enrollment writes);
- change auth principal, sessions, or `AuthRepository`;
- add API or UI routes;
- add `projects.workspace_id` or change project/asset repositories;
- broaden role grants beyond what callers explicitly request.

## 3. Decisions (frozen)

| Decision | Choice |
|---|---|
| Scope | Thin Task 4: identity / membership only |
| Depth | Read + minimal write |
| CAS | Required on every management write |
| Audit | Deferred |
| Port shape | Single `WorkspaceDirectoryRepository` (same pattern as `AuthRepository`) |
| Authorization | Port does not authorize; callers pass workspace boundaries; missing cross-workspace rows return not-found |

## 4. Architecture

### 4.1 Dependency direction

```text
workspace-directory          project-store-sqlite
  models / validation   <---   createSqliteWorkspaceDirectoryRepository(db)
  WorkspaceDirectoryRepository
        ^
        |
  openSqliteStore() returns { ..., directoryRepo }
```

- `workspace-directory` must not import SQLite or `project-store-sqlite`.
- The adapter maps rows to existing domain models and reuses existing
  `validate*` helpers where applicable.

### 4.2 Transaction contract

```ts
interface WorkspaceDirectoryRepository {
  withTransaction<T>(fn: (tx: WorkspaceDirectoryRepositoryTx) => T): T;
}
```

- Synchronous only; no `await` inside the transaction callback.
- Adapter uses the shared `better-sqlite3` connection and
  `db.transaction(...)` (same as `createSqliteAuthRepository`).
- One write path per management mutation: CAS check → DML → bump revision.

## 5. Tables in scope

| Table | Read | Write in this slice |
|---|---|---|
| `workspaces` | yes | optional `createWorkspace` |
| `user_accounts` | yes | no (accounts remain auth/backfill owned) |
| `people` | yes | create / update |
| `person_account_links` | yes | link / unlink |
| `workspace_memberships` | yes | create / end |
| `role_assignments` (workspace scope only) | yes | grant / end |
| `workspace_directory_revisions` | yes | CAS bump on management writes |

Out of scope tables remain untouched: school/roster/import/audit and all
legacy org tables.

## 6. Port surface

### 6.1 Reads

- `getWorkspace(workspaceId)`
- `listWorkspacesForAccount(accountId)` — workspaces with an active membership
- `getUserAccount(accountId)`
- `getPerson(personId)`
- `getActivePersonAccountLinkByAccount(accountId)`
- `getActivePersonAccountLinkByPerson(personId)`
- `listMembershipsForWorkspace(workspaceId, { includeEnded })`
- `listMembershipsForAccount(accountId, { includeEnded })`
- `listWorkspaceRoleAssignments(workspaceId, { includeEnded })` — `scope.kind === "workspace"` only
- `getDirectoryRevision(workspaceId)` → `{ revision: number; updatedAt: string }`

Missing entities return `null` from getters / empty lists from list methods.
Cross-workspace forged IDs must not leak sibling-tenant data (see §8).

### 6.2 Minimal writes (all CAS-gated)

Every write method takes `expectedRevision: number` for the target workspace
(or, for person/link ops that are not inherently workspace-scoped, the caller
must pass the **workspace whose directory revision gates the edit** — see §7.2).

On success, methods return the new revision (and created row where useful).

Required writes:

- `createPerson({ workspaceId, expectedRevision, person })`
- `updatePerson({ workspaceId, expectedRevision, personId, patch })`
- `linkPersonAccount({ workspaceId, expectedRevision, link })`
- `unlinkPersonAccount({ workspaceId, expectedRevision, linkId, unlinkedAt })`
- `createMembership({ expectedRevision, membership })`
- `endMembership({ expectedRevision, membershipId, endedAt })`
- `grantWorkspaceRole({ expectedRevision, assignment })` — workspace scope only
- `endWorkspaceRole({ expectedRevision, assignmentId, endedAt })`

Optional write:

- `createWorkspace({ workspace, initialRevision?: 0 })` — inserts workspace +
  directory revision row `0` (or specified). Does not require CAS of a prior
  revision. Subsequent membership/role writes use CAS as usual.

### 6.3 What writers must not do

- Insert `role_assignments` with `system` / `school` / `class` / `project` scope.
- Synthesize owner roles unless the caller passes an explicit owner membership
  or workspace-scope owner assignment.
- Touch `user_accounts` rows (create/update/disable) in this slice.
- Write `audit_events`.

## 7. CAS and revision rules

### 7.1 Algorithm (inside one sync transaction)

1. `SELECT revision, updated_at FROM workspace_directory_revisions WHERE workspace_id = ?`
2. If no revision row for an existing workspace → `DIRECTORY_INVALID` (v5 and
   target schema require a row per workspace; missing row is corrupt).
3. If `revision !== expectedRevision` → `DIRECTORY_REVISION_CONFLICT`
4. Apply DML
5. `UPDATE workspace_directory_revisions SET revision = revision + 1, updated_at = ?`
6. Return new revision

Concurrent writers: exactly one CAS winner; loser sees conflict; no partial
directory mutation remains.

### 7.2 Workspace gate for person / link writes

Person and person-account-link rows are globally keyed, not
`workspace_id`-scoped. To keep a single CAS clock and avoid silent
cross-tenant edits, every person/link write **requires an explicit
`workspaceId`** whose directory revision is the gate.

Contract tests must prove:

- a forged `workspaceId` that does not contain an active membership (or other
  caller-proven relationship — this slice only checks that the workspace and
  its revision row exist) still fails closed on CAS/not-found as specified;
- successful person/link writes bump **that** workspace's revision only.

Authorization that the actor may edit that workspace remains outside the port
(service layer in later slices). The repository only enforces structural CAS
and uniqueness.

## 8. Error contract

Typed errors thrown from the adapter (and allowed from port documentation):

| Code | When |
|---|---|
| `DIRECTORY_NOT_FOUND` | Required target row missing (membership/role/link end, get-by-id used as write precondition). Prefer this over boolean “false” for write preconditions. |
| `DIRECTORY_REVISION_CONFLICT` | CAS mismatch |
| `DIRECTORY_CONFLICT` | Unique active link or active membership violation (SQLite constraint or pre-check) |
| `DIRECTORY_INVALID` | Domain validation failure or corrupt/missing revision row |

BOLA / existence hiding for **reads**: getters return `null`; lists omit
foreign-tenant rows. Writers that target another tenant’s membership/role IDs
return `DIRECTORY_NOT_FOUND` (do not reveal that the ID exists elsewhere).

## 9. Store wiring

`openSqliteStore` return type gains:

```ts
directoryRepo: WorkspaceDirectoryRepository;
```

Created once per open, sharing the same `Database` as `authRepo` /
`projectRepo`. Closing the store closes the shared connection; no second
connection factory.

## 10. Testing

### 10.1 Package boundary

- `workspace-directory` continues to forbid SQLite imports.
- Port types export from `workspace-directory` public entry.

### 10.2 Contract tests (`project-store-sqlite`)

Against a DB that has run migrations through v5 (copied legacy fixture and/or
fresh empty file DB as needed):

1. Read backfilled workspaces, people, links, memberships, workspace roles.
2. CAS success bumps revision by 1; concurrent second writer with stale
   `expectedRevision` gets `DIRECTORY_REVISION_CONFLICT` and no row change.
3. Duplicate active person↔account link → `DIRECTORY_CONFLICT`.
4. Duplicate active membership `(workspace_id, account_id)` → `DIRECTORY_CONFLICT`.
5. End/get with foreign workspace membership id → `DIRECTORY_NOT_FOUND`.
6. Failed write rolls back DML and leaves revision unchanged.
7. `openSqliteStore(...).directoryRepo` is usable without a second open.

### 10.3 Gates

- `pnpm --filter @blocksync/workspace-directory typecheck test`
- `pnpm --filter @blocksync/project-store-sqlite typecheck test`
- `pnpm r1:persist:test` (or the current persist aggregate) before handoff

## 11. Implementation sketch (not a plan)

Ordered delivery for the later TDD plan:

1. Port types + error codes in `workspace-directory`
2. Failing contract tests in `project-store-sqlite`
3. SQLite adapter
4. `openSqliteStore` wiring
5. Package gates + handoff

## 12. Commit intent

- `feat(directory): add workspace directory repository port`
- `feat(store): sqlite workspace directory repository`

## 13. Relation to full roadmap Task 4

Roadmap Task 4 also lists claim state, attendance uniqueness, last-owner
refusal, and broader CRUD/history/audit. Those remain **explicit follow-on
slices** after this thin repository lands. This design satisfies the
dependency-direction and store-wiring portions of Task 4 for identity tables
only.
