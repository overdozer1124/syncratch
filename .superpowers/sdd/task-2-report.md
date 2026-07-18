# Task 2 Report: Browser-safe project and SB3 core

## Status

DONE

The browser-safe Task 2 section at the start of `task-2-brief.md` was implemented. The older SQLite enrollment appendix in the same file was already present in branch history and was not changed.

## Commit baseline

- Starting HEAD: `098693781810c71fed391be1e743ded9a11c469a`
- Implementation commit: `3855971` (`feat(project): add browser-safe local core`)
- Task 1 documents, the external Cursor plan, and pre-existing user-owned working-tree files were not staged or changed by this task.

## Implementation

- Replaced reusable Node `crypto` hashing with pinned `@noble/hashes@2.2.0`.
  - `ProjectEnvelopeV1`, canonical JSON, request material, and public exports were left unchanged.
  - Existing content/request hash vectors remain byte-for-byte identical.
  - SB3 SHA-256, stable target IDs, and MD5 asset verification retain their existing vectors.
- Removed runtime `node:fs`, `node:path`, and `node:url` dependencies from the ProjectDocument opcode validator by embedding the pinned v14.1.0 artifact.
  - Added a generated-contract equality test to prevent the embedded artifact from drifting from the vendor artifact.
- Added SB3 package entry points:
  - `@blocksync/sb3-tools/browser`: normal load/export/canonical/media APIs only.
  - `@blocksync/sb3-tools/node`: isolated loader.
  - Existing root exports remain compatible; the isolated loader delegates to the Node entry point.
- Added `@blocksync/project-local-core`:
  - `blocksync.local-project/v1`
  - local project ID, title, non-negative revision, strict UTC `updatedAt`, ProjectDocument, asset `Uint8Array` records, save state, and optional Drive file ID
  - strict unknown-field rejection, including `organizationId` and `updatedByUserId`
  - ProjectDocument validation through the existing `validateProject`
  - typed-array byte identity preservation
- Added an esbuild browser bundle smoke that executes project hashing and SB3 browser exports, and rejects Node imports or browser-external stubs.

## TDD evidence

### RED

Command:

```text
pnpm --filter @blocksync/project-local-core test
```

Observed result: exit 1.

- `@blocksync/sb3-tools/browser` was not exported.
- `project-envelope` pulled `node:crypto`.
- ProjectDocument validation pulled `node:fs`, `node:path`, and `node:url`.
- `project-local-core/src/index.ts` did not exist.

These failures directly represented the missing browser boundary and LocalProjectRecord implementation.

### GREEN

Focused command:

```text
pnpm --filter @blocksync/project-schema --filter @blocksync/project-envelope --filter @blocksync/project-local-core --filter @blocksync/sb3-tools test
```

Result: exit 0.

- project-schema: 66 tests passed
- project-envelope: 18 tests passed
- sb3-tools: 42 tests passed
- project-local-core: 14 tests passed
- Total: 140 tests passed

Affected dependent command:

```text
pnpm --filter @blocksync/project-service --filter @blocksync/project-store-sqlite --filter @blocksync/r1-persist-server test
```

Result: exit 0.

- project-service: 49 tests passed
- project-store-sqlite: 291 tests passed
- r1-persist-server: 84 tests passed
- Total: 424 tests passed

The SB3 suite emitted the existing Scratch VM warnings about no rendering module while loading costumes; no test failed.

## Typecheck and build

Command:

```text
pnpm --filter @blocksync/project-schema --filter @blocksync/project-envelope --filter @blocksync/project-local-core --filter @blocksync/project-service --filter @blocksync/project-store-sqlite --filter @blocksync/r1-persist-server typecheck
```

Result: exit 0 for all six packages/apps.

`@blocksync/sb3-tools` has no separate typecheck script; its `tsc` build passed.

Workspace command:

```text
pnpm build
```

Result: exit 0 for all 16 selected workspace projects/apps, including project-schema, project-envelope, sb3-tools, project-local-core, project-service, and project-store-sqlite.

## Self-review

- Confirmed no production `node:` import remains in project-envelope.
- Confirmed SB3 Node built-ins exist only in `src/node.ts`; the browser bundle smoke contains neither Node imports nor browser-external stubs.
- Confirmed the old root `loadSb3Isolated` tests still exercise oversize rejection and timeout cleanup.
- Confirmed `@noble/hashes` is exact-pinned in both package manifests and `pnpm-lock.yaml`.
- Confirmed the embedded opcode artifact exactly matches the generated vendor contract and added a regression check for future drift.
- Confirmed `git diff --cached --check` passed before the implementation commit.
- Independent code review found no Critical issues. Its artifact-drift concern was addressed with the generated-contract equality test. The pre-existing `task-2-brief.md` working-tree change was deliberately excluded from the commit.

## Concerns

None.
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
