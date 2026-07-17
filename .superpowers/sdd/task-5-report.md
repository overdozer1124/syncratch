# Task 5 Report: Verified Pre-v5 VACUUM Backup Gate

## Status

Implemented and verified the synchronous pre-v5 backup preparation gate:

- `packages/project-store-sqlite/src/migrations/backfill/backup.ts`
- `packages/project-store-sqlite/src/migrations/backfill/backup.test.ts`

No v5 DML, registry wiring, or `docs/ai-platform/` changes were added. The
exact v5 name/checksum contract needed by the race check is centralized in
`backfill/v5-descriptor.ts` for Task 6 to reuse.

## TDD evidence

### RED

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/backfill/backup.test.ts
```

Exit 1: Vitest failed to load the intentionally absent `./backup.js`; one
suite failed before implementation.

### GREEN

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/backfill/backup.test.ts
Test Files  1 passed (1)
Tests       16 passed (16)
Exit code: 0
```

```text
pnpm --filter @blocksync/project-store-sqlite typecheck
tsc -p tsconfig.json --noEmit
Exit code: 0
```

```text
pnpm --filter @blocksync/project-store-sqlite test
Test Files  25 passed (25)
Tests       241 passed (241)
Exit code: 0
```

## Coverage

- Legacy-empty memory/file databases return `empty` without a backup.
- Non-empty in-memory legacy data fails with `SCHEMA_BACKUP_FAILED`.
- The committed fixture is copied before use and explicitly advanced to v4.
- Adjacent names compact `appliedAt` exactly and use 16 lowercase random hex
  characters; repeated preparations use distinct names.
- Apostrophes in destinations are safely escaped for `VACUUM INTO`.
- Existing destinations are never overwritten or reused.
- Integrity, FK, version, committed fingerprint, and digest mismatches fail
  closed; failed artifacts remain as evidence.
- Verification uses an independent readonly connection, enables foreign keys,
  and closes in `finally` before Windows rename.
- Only exact live v5 version/name/checksum evidence renames once to
  `.superseded-v5.sqlite` and returns `already_applied`.
- Successful artifacts have no adjacent WAL/SHM sidecars.

## Self-review

- All failures are wrapped as `SchemaMigrationError` with
  `SCHEMA_BACKUP_FAILED`; no failed artifact is deleted.
- Seams are limited to destination selection, post-VACUUM mutation, and rename
  observation and are not exported from the package API.
- Independent review found no critical/high defects. Its checksum-drift
  warning was fixed by the shared descriptor source.
- `git diff --check` exited 0.

## Concerns

No functional concerns identified within Task 5 scope.
