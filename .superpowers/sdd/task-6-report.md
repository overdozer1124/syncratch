# Task 6 Report: Immutable Version 5 Backfill DML

## Status

Implemented the immutable version 5 migration module and direct tests:

- `packages/project-store-sqlite/src/migrations/0005-r1-legacy-organization-user-backfill.ts`
- `packages/project-store-sqlite/src/migrations/0005-r1-legacy-organization-user-backfill.test.ts`

`prepare` delegates to `prepareLegacyBackfillBackup`. Shared
name/checksumSource/checksum come from `backfill/v5-descriptor.ts` (checksum
source is not redefined). Production `index.ts` was not wired (Task 7).

## TDD evidence

### RED

```text
pnpm --filter @blocksync/project-store-sqlite test -- \
  src/migrations/0005-r1-legacy-organization-user-backfill.test.ts
```

Exit 1: Vitest failed to load the intentionally absent
`./0005-r1-legacy-organization-user-backfill.js`; suite failed before
implementation.

### GREEN

```text
pnpm --filter @blocksync/project-store-sqlite test -- \
  src/migrations/0005-r1-legacy-organization-user-backfill.test.ts
Test Files  1 passed (1)
Tests       7 passed (7)
Exit code: 0
```

```text
pnpm --filter @blocksync/project-store-sqlite typecheck
tsc -p tsconfig.json --noEmit
Exit code: 0
```

## Coverage

- Immutable version/name/checksum equals the hard-coded SHA-256 and shared
  descriptor exports.
- Copied fixture: verified backup, every planned target row, only null
  sessions revoked to `appliedAt`, empty `PRAGMA foreign_key_check`.
- Empty preparation: no backup, zero target rows, ledger reaches version 5.
- `already_applied` while pending throws `SCHEMA_BACKFILL_INVALID` with no
  target writes.
- Locked digest mismatch after prepare: `SCHEMA_BACKFILL_INVALID`,
  `user_version=4`, zero target rows, backup retained, sessions unrevoked.
- Both fault points roll back target rows and session revocation, leave no v5
  ledger row / `user_version=4`, retain backup, and retry with a fixed clock
  matches one-shot target + session rows.

## Apply contract

1. Validate preparation discriminant / require context.
2. `empty`: prove live source empty, return (no DML).
3. `already_applied`: throw `SCHEMA_BACKFILL_INVALID`.
4. `verified`: recompute live digest under lock first; mismatch aborts before
   DML.
5. Read source, compute plan (includes validation), insert in FK order,
   revoke sessions by explicit `id_hash` with `WHERE revoked_at IS NULL`,
   assert update count.
6. No nested transaction and no second Database connection in `apply`.

## Concerns

None within Task 6 scope. Registry integration and broader integration/race
gates remain Task 7.
