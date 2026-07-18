# Task 2 Report: Failing SQLite Enrollment Contracts

## Scope completed

- Added the deterministic `openEnrollmentDb` fixture helper inside the SQLite directory repository writes suite.
- Added six enrollment behavior contracts:
  1. successful create, revision bump, and read round-trip;
  2. duplicate active class attendance number conflict with no second row or revision bump;
  3. multiple active `null` attendance numbers;
  4. foreign-workspace class rejection with neither workspace revision changed;
  5. stale revision rejection with no row or revision change;
  6. invalid `updatedAt` rejection with no row or revision change.
- Added compiling SQLite adapter stubs only:
  - `getEnrollment` returns `null`;
  - `createEnrollment` throws `DirectoryError("DIRECTORY_INVALID", "enrollment write not implemented")`.
- Did not add enrollment SQL, reads, writes, conflict queries, or call `findAttendanceNumberConflicts`.
- Did not modify `docs/ai-platform/`.

## Verification

Command:

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/directory-repository.contract.test.ts
```

Result: expected non-zero RED run. The focused suite ran 27 tests: 22 passed and 5 failed.

- All 21 pre-existing cases passed.
- Five new contracts failed against the stubs, as expected.
- The sixth new contract (invalid `updatedAt`) passed unexpectedly because its specified expected error code, `DIRECTORY_INVALID`, and unchanged revision/absent row assertions are all also satisfied by the required generic stub.

## Review

Self-review and independent code review confirmed:

- Fixture hierarchy and SQL values match the task brief and the migrated schema.
- The adapter satisfies the Task 1 port signatures and adds no real enrollment behavior.
- The five failing contracts expose the intended stub behavior.

## Concern

The brief's required stub and the invalid-`updatedAt` contract are internally indistinguishable under the specified assertions: both produce `DIRECTORY_INVALID`, leave revision `0`, and return no enrollment. Therefore the instruction to prove that all six cases fail cannot be met without adding a message-level assertion or changing either the stub or the contract, each of which would exceed the stated contract pattern. This implementation preserves the brief's requested code-based error assertion.

## Review fix

- Strengthened the invalid-`updatedAt` contract to require
  `DIRECTORY_INVALID` plus a message containing `UtcDateTime`, which is the
  validation message Task 3 will produce and the required stub does not.
- Kept the stub unchanged:
  `DirectoryError("DIRECTORY_INVALID", "enrollment write not implemented")`.
- Updated the Task 2 brief and implementation plan Step 4 wording to document
  the distinguishing message assertion.

## Verification after review fix

Command:

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/directory-repository.contract.test.ts
```

Result: expected non-zero RED run. The focused suite ran 27 tests: 21
pre-existing tests passed and all 6 new enrollment contracts failed against
the stub. The invalid-`updatedAt` case now fails because the stub message does
not contain `UtcDateTime`.
