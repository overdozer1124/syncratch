# R1 Directory Constraint Error Mapping Design

**Date:** 2026-07-18  
**Status:** Draft design (awaiting user review)  
**Predecessor:** [R1 Workspace Directory Repositories](2026-07-18-r1-workspace-directory-repositories-design.md)  
**Roadmap:** Follow-up to Phase 3 Task 4 thin slice (error-contract hardening)

## 1. Goal

Narrow SQLite constraint handling in
`createSqliteWorkspaceDirectoryRepository` so error codes match the thin-slice
error contract (§8 of the predecessor design):

| SQLite `error.code` | DirectoryError |
|---|---|
| `SQLITE_CONSTRAINT_UNIQUE` | `DIRECTORY_CONFLICT` |
| `SQLITE_CONSTRAINT_PRIMARYKEY` | `DIRECTORY_CONFLICT` |
| `SQLITE_CONSTRAINT_FOREIGNKEY` | `DIRECTORY_NOT_FOUND` |
| Other `SQLITE_CONSTRAINT*` (CHECK, NOT NULL, …) | `DIRECTORY_INVALID` |
| Non-constraint errors | rethrow unchanged |

## 2. Non-goals

- claim / attendance uniqueness / last-owner protection;
- school roster / audit / API / UI;
- changing port method signatures;
- rewriting non-SQLite validation paths (domain validators stay first line).

## 3. Motivation

The thin-slice adapter used `code.startsWith("SQLITE_CONSTRAINT")` and mapped
**all** constraint failures to `DIRECTORY_CONFLICT`. Spec §8 limits
`DIRECTORY_CONFLICT` to unique active link / membership (and similar unique)
violations. FK failures (e.g. `createMembership` with a missing `accountId`)
were incorrectly reported as conflicts.

## 4. Design

### 4.1 Mapping helper

Replace `isSqliteConstraintError` + `runOrConflict` with:

- `mapSqliteConstraint(error): DirectoryError | null` — returns a mapped
  `DirectoryError` for known constraint codes, else `null`.
- `runMappedConstraint(fn)` — `try/catch` around DML; throw mapped error or
  rethrow.

Message strings may stay generic (e.g. `"unique constraint violated"`,
`"referenced row not found"`, `"constraint violated"`). Exact wording is not
part of the public contract; **codes** are.

### 4.2 Call sites

Every existing `runOrConflict(...)` call in `directory-repository.ts` becomes
`runMappedConstraint(...)`. No other behavioral change to CAS, BOLA, or
validators.

### 4.3 Spec amendment (predecessor §8)

Clarify the table:

| Code | When |
|---|---|
| `DIRECTORY_NOT_FOUND` | … **or** SQLite `FOREIGN KEY` violation on a write |
| `DIRECTORY_CONFLICT` | Unique / primary-key constraint on active link, membership, role grant, or equivalent unique write |
| `DIRECTORY_INVALID` | Domain validation failure, corrupt/missing revision row, **or** other SQLite constraints (CHECK / NOT NULL / …) |

## 5. Testing

Keep existing UNIQUE → `DIRECTORY_CONFLICT` cases.

Add at least:

1. **FK:** `createMembership` (or `linkPersonAccount`) with a non-existent
   `accountId` / `personId` → `DIRECTORY_NOT_FOUND`; directory revision
   unchanged.
2. Prefer covering one path that actually hits the FK at the adapter (domain
   validators must not block the test fixture IDs before SQL runs — use IDs
   that pass shape validation but are absent from tables).

CHECK → `DIRECTORY_INVALID` is optional if domain validators always reject
invalid enums first; document that residual CHECK hits still map via the
default branch.

### Gates

- `pnpm --filter @blocksync/project-store-sqlite test -- src/directory-repository.contract.test.ts`
- `pnpm --filter @blocksync/project-store-sqlite typecheck`

## 6. Files

| Path | Change |
|---|---|
| `packages/project-store-sqlite/src/directory-repository.ts` | Constraint mapping |
| `packages/project-store-sqlite/src/directory-repository.contract.test.ts` | FK (and optional CHECK) cases |
| `docs/superpowers/specs/2026-07-18-r1-workspace-directory-repositories-design.md` | §8 clarification |
| This file | Follow-up design record |

## 7. Out of scope follow-ups (unchanged)

- Idempotent `end*` / `unlink` guards
- target-schema allowlist full-path match
- Task 4 remainder: claim / attendance / last-owner
