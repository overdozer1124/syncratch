# R1 Directory Last-Owner Protection Design

**Date:** 2026-07-18  
**Status:** Draft design (awaiting user review)  
**Predecessor:** [R1 Workspace Directory Repositories](2026-07-18-r1-workspace-directory-repositories-design.md)  
**Roadmap:** [R1 Workspace Roster Access Plan, Phase 3 Task 4](../plans/2026-07-16-r1-workspace-roster-access-plan.md) (last-owner refuse slice)

## 1. Goal

Refuse ending the **last active Workspace Owner membership** in a workspace
via `WorkspaceDirectoryRepositoryTx.endMembership`, with a typed
`DIRECTORY_LAST_OWNER` error. No atomic transfer in this slice.

**Workspace Owner** for this slice means a row in `workspace_memberships` with
`role = 'owner'` and `status = 'active'`. System Owner and
`role_assignments`-based owners are out of scope.

## 2. Non-goals

- System-scoped owner protection
- Counting or mutating `role_assignments` for last-owner rules
- Atomic owner transfer API
- Membership role update / demote methods (no such port method today)
- claim / attendance uniqueness / audit / API / UI
- Changing CAS, BOLA, or constraint-mapping behavior beyond the new guard

## 3. Error contract

Add to `DirectoryErrorCode`:

| Code | When |
|---|---|
| `DIRECTORY_LAST_OWNER` | `endMembership` would leave the workspace with zero active `role='owner'` memberships |

Other codes unchanged.

## 4. Domain helper

New pure helper in `@blocksync/workspace-directory` (e.g. `last-owner.ts`):

```ts
assertCanEndWorkspaceOwnerMembership(input: {
  membership: WorkspaceMembership;
  activeOwnerCountInWorkspace: number;
}): void
```

Rules:

1. If `membership.role !== "owner"` **or** `membership.status !== "active"` →
   return (allow).
2. If `activeOwnerCountInWorkspace <= 1` → throw
   `DirectoryError("DIRECTORY_LAST_OWNER", ...)`.
3. Otherwise return (allow).

`activeOwnerCountInWorkspace` is the count **before** the end DML, including
the membership being ended when it is an active owner.

Export from the package public entry. Unit-test the three branches above
without SQLite.

## 5. Adapter integration

In `createSqliteWorkspaceDirectoryRepository` → `endMembership`, after the
existing tenant/`DIRECTORY_NOT_FOUND` check and **before** CAS bump / DML:

1. Query  
   `SELECT COUNT(*) AS n FROM workspace_memberships WHERE workspace_id = ? AND status = 'active' AND role = 'owner'`
2. Call `assertCanEndWorkspaceOwnerMembership({ membership: existing, activeOwnerCountInWorkspace: n })`
3. Proceed with existing validate → `assertAndBumpRevision` → end DML

Do not change `endWorkspaceRole`, `createMembership`, or other write methods.

Synchronous transaction only (already true for `withTransaction`).

## 6. Testing

### 6.1 Domain

- last active owner → throws `DIRECTORY_LAST_OWNER`
- two active owners → no throw when ending one
- non-owner or already-ended membership → no throw

### 6.2 Contract (`directory-repository.contract.test.ts`)

1. Sole active owner membership `endMembership` → `DIRECTORY_LAST_OWNER`;
   revision unchanged.
2. Insert / create a second active owner, then end one → success; revision +1.
3. Ending a non-owner active membership still succeeds.

Adjust the existing “endMembership ends an active membership” case if the
fixture row is the sole owner (use a non-owner row or pre-create a second
owner).

### 6.3 Gates

- `pnpm --filter @blocksync/workspace-directory test`
- `pnpm --filter @blocksync/workspace-directory typecheck`
- `pnpm --filter @blocksync/project-store-sqlite test -- src/directory-repository.contract.test.ts`
- `pnpm --filter @blocksync/project-store-sqlite typecheck`

## 7. Files

| Path | Change |
|---|---|
| `packages/workspace-directory/src/errors.ts` | Add `DIRECTORY_LAST_OWNER` |
| `packages/workspace-directory/src/last-owner.ts` | Helper |
| `packages/workspace-directory/src/last-owner.test.ts` | Unit tests |
| `packages/workspace-directory/src/index.ts` | Re-export |
| `packages/workspace-directory/src/package-boundary.test.ts` | Include new source if listed |
| `packages/project-store-sqlite/src/directory-repository.ts` | Guard in `endMembership` |
| `packages/project-store-sqlite/src/directory-repository.contract.test.ts` | Contract cases |
| Predecessor design §8 (optional one-line) | Document new code |
| `docs/CURSOR_CODEX_HANDOFF.md` | Slice status at implementation time |

## 8. Follow-ons (explicit)

- Atomic transfer of Workspace Owner
- System Owner last-owner rules
- Aligning membership `role` vs workspace `role_assignments` capability matrix
- claim / attendance slices
