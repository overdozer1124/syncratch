# Task 5 Report: Store wiring + package gates

## Status

Done. `openSqliteStore()` now exposes `directoryRepo` from the same SQLite
connection. The legacy-v1 fixture store intentionally omits the directory
adapter because its pre-migration schema does not contain directory tables.

## Commit

`50c01e3` — `feat(store): expose directoryRepo from openSqliteStore`

## Tests

- RED: the new store smoke failed with `directoryRepo` undefined.
- GREEN: focused directory repository smoke, including legacy fixture, passed
  (18 tests).
- `pnpm --filter @blocksync/workspace-directory typecheck` — PASS
- `pnpm --filter @blocksync/workspace-directory test` — PASS (62 tests)
- `pnpm --filter @blocksync/project-store-sqlite typecheck` — PASS
- `pnpm --filter @blocksync/project-store-sqlite test` — PASS (271 tests)
- `pnpm r1:persist:test` — PASS
- `git diff --check` — PASS before commit.

## Guard and scope

The target-schema production SQL guard now permits only
`directory-repository.ts`, the intentional post-cutover adapter; it continues
to reject target-table SQL in all other production consumers. The roadmap
records only the identity/membership thin slice; claim, attendance, last-owner,
and audit work remain unchecked.

## Concerns

None. Existing untracked `.superpowers/sdd` task artifacts were not staged.

## Review fix notes (2026-07-18)

- Removed unrelated Pre-v5 VACUUM backup gate section that was appended by mistake.
- Corrected contract smoke count from 19 to 18 (verified via
  `pnpm --filter @blocksync/project-store-sqlite test -- src/directory-repository.contract.test.ts`).
- Pinned thin-slice implementation SHA to `50c01e3`; docs commits are not the implementation tip.
