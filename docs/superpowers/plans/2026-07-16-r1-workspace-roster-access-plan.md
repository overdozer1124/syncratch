# R1 Workspace, Roster & Scoped Access Implementation Plan

> **Status:** Approved execution roadmap — implement through the linked detailed subplans
>
> **Design:** `docs/superpowers/specs/2026-07-16-r1-workspace-roster-access-design.md` (approved at `3dda2b8`)
>
> **Master specification:** `docs/specification/BlockSync-AI_システム仕様書・実装計画書_v1.2.md`
>
> **Execution order:** Finish the approved Scratch/SB3 slice, then execute this plan before realtime collaboration or AI product work.

**Goal:** Ship the full initial foundation for Person/UserAccount separation, multi-workspace membership, schools, years, grades, classes, attendance numbers, roster import, scoped access and a minimal management UI without making school setup mandatory for personal/casual use.

**Architecture:** Keep authentication user-centric and authorization resource/workspace-centric. Reuse the existing ports/adapters boundary, one shared SQLite connection, synchronous transactions, Hono security middleware and durable project ACL. Add versioned migrations and preserve all accepted V1 hashes.

**Tech stack:** TypeScript, pnpm, Vitest, Hono, better-sqlite3, existing React/Vite host where applicable, Playwright for management UI E2E.

## Global constraints

- Do not edit or rehash schemaVersion 1 project envelopes.
- Do not rewrite approved auth/persistence Go documents as if the old implementation never existed; record this slice as the superseding migration.
- Do not use email equality for automatic Person/UserAccount linking.
- Do not put `workspaceId` permanently into the authenticated identity.
- Do not infer system authorization from Teacher/Student facts.
- No async callback inside `withTransaction<T>`.
- No school/class requirement for personal or casual project creation.
- Roster foundation means schema + repository + service + API + minimal UI in this slice, not schema-only placeholders.
- Preserve generic auth error bodies, CSRF, Origin/CORS, cookie attributes, 404 existence hiding and BOLA tests.

## Phase 0 — Documentation discovery and frozen compatibility fixtures

### Allowed APIs and patterns

Copy and extend only these existing patterns:

| Pattern | Source |
|---|---|
| Identity-only interface | `packages/auth-context/src/index.ts` — `AuthContext.resolve()` |
| Repository port and sync TX | `packages/session-service/src/ports.ts` — `AuthRepository.withTransaction<T>(fn): T` |
| Shared DB factory | `packages/project-store-sqlite/src/store.ts` — `openSqliteStore({dbPath})` |
| WAL/FK initialization | `packages/project-store-sqlite/src/migrate.ts` and `migrate-auth.ts` |
| Durable project authorization | `packages/project-service/src/access.ts` — `ProjectAccessPolicy` flow |
| Atomic project creation | `packages/project-store-sqlite/src/project-repository.ts` |
| Generic auth/Cookie/CSRF/Origin handling | `apps/r1-persist-server/src/server.ts` |
| V1 canonical hash freeze | `docs/superpowers/specs/2026-07-15-r1-project-persistence-design.md` |
| V1/V2 SB3 compatibility constraints | `docs/superpowers/specs/2026-07-16-r1-scratch-sb3-design.md` |

APIs that do **not** exist and must not be assumed: workspace selection, person claims, roster repository, versioned migration runner, project invitations, project host transfer and management UI routes.

### Task 0: Freeze migration inputs

**Files:** new fixtures under `packages/project-store-sqlite/src/fixtures/`; new migration acceptance test; no production mutation yet.

**Status:** Complete and green. The first RED production-migration test begins in Task 2.

**Detailed plan:** [R1 Workspace Migration Fixtures Implementation Plan](2026-07-17-r1-workspace-migration-fixtures-plan.md)

- [x] Create an actual pre-migration SQLite fixture through the approved persistence/auth APIs.
- [x] Record users, external identities, memberships, sessions, projects, revision envelope bytes, content hashes, transaction ids and snapshots.
- [x] Add a V1 project hash fixture copied from the accepted persistence/SB3 tests.
- [x] Freeze target-state assertions and byte-stable evidence while keeping this fixture-only task green.
- [x] Document the migration matrix in `docs/r1/WORKSPACE_ROSTER_MIGRATION.md`.

**Verification:** fixture copies and reopens on current HEAD; hashes and raw bytes match committed expected values; all Task 0 tests remain green. No production-migration test is introduced before Task 2.

**Anti-pattern guards:** no hand-authored fake DB schema; no JSON reserialization of frozen envelopes; do not modify the active Scratch/SB3 design.

## Phase 1 — Domain contracts

### Task 1: Add workspace-directory domain package

**Files:** `packages/workspace-directory/**`, workspace configuration.

Copy validation/result conventions from `packages/project-schema` and port boundaries from `packages/session-service/src/ports.ts`.

Define:

- branded IDs and validated inputs
- Person, PersonAccountLink, Workspace and WorkspaceMembership
- School, AcademicYear, Grade, ClassGroup
- Enrollment, StaffAssignment
- scoped role/capability matrix
- RosterImport preview/apply types
- AuditEvent and optimistic directory revision

- [x] Failing validator and capability matrix tests.
- [x] Implement pure types, validation and permission evaluation.
- [x] Export only domain contracts; no SQLite or Hono imports.
- [x] Commit: `feat(directory): workspace roster and scoped access contracts`.

**Verification:** teacher/student facts never satisfy system capabilities; student + explicit project-host role does; attendance number nullable.

**Anti-pattern guards:** no global `role` field on UserAccount; no single `organizationId` on the authenticated principal; no database access in this package.

## Phase 2 — Versioned SQLite migration

### Task 2: Migration ledger and target schema

**Files:** `packages/project-store-sqlite/src/migrations/**`, `store.ts`, migration tests.

Task 2 is split. The **ledger-only** sub-slice lands first and must GO before any
Workspace/Person target schema or backfill work.

**Detailed plan (ledger-only):** [R1 Versioned SQLite Migration Ledger Implementation Plan](2026-07-17-r1-versioned-migration-ledger-plan.md)

That ledger slice adds `schema_migrations`, the ordered synchronous runner,
accepted-legacy adoption, crash/retry guards, and concurrent-startup proof. It
does **not** create `workspaces`, `people`, `user_accounts`,
`person_account_links`, `workspace_memberships`, roster, permission, or audit
tables.

**Deferred until ledger GO:** create tables from Design §§4–5 (explicit FKs,
CHECKs, indexes) on the shared connection, then ordered domain migrations that
depend on those tables.

**Approved Person ID strategy (record only; no tables in the ledger slice):**
`user_accounts.id` retains the legacy `users.id`; `people.id` is derived
deterministically from a fixed namespace and the legacy user ID. Implement that
mapping only in the later Workspace/Person schema plan.

- [ ] Ledger-only sub-slice (detailed plan above): fresh/reopen/partial-crash,
  adoption, busy/race, and frozen-evidence gates.
- [ ] After ledger GO: add target Workspace/Person tables and constraints.
- [ ] Change migration order so referenced workspace/account tables exist before new FKs.
- [ ] Commit ledger first (`feat(store): …` / `test(store): prove concurrent migration startup`);
  target schema commit remains `feat(store): versioned workspace roster schema`.

### Task 3: Migrate accepted single-org databases

**Blocked until the Task 2 ledger-only sub-slice is GO.** Do not start Task 3+
domain migration while ledger adoption/concurrency remains incomplete.

- [ ] Convert every organization to a workspace with the same ID.
- [ ] Create Person + account link for every existing user (using the approved
  deterministic Person ID strategy recorded under Task 2).
- [ ] Convert memberships and project ownership without broadening access.
- [ ] Migrate or revoke old org-scoped sessions fail-closed.
- [ ] Keep project envelope bytes, V1 hashes, snapshots and transaction ids unchanged.
- [ ] Verify restart halfway through the migration is recoverable.
- [ ] Commit: `feat(store): migrate legacy organizations without rehash`.

**Verification:** Task 0 fixture migrates; old BOLA remains; byte/hash comparisons pass; foreign-key check returns no rows.

**Anti-pattern guards:** `CREATE TABLE IF NOT EXISTS` alone is not a migration strategy; no direct rename inside V1 envelope JSON; no second SQLite connection factory.

## Phase 3 — Repositories and directory services

**Blocked until the Task 2 ledger-only sub-slice is GO.**

### Task 4: Repository ports and SQLite adapters

**Files:** domain ports in `packages/workspace-directory`; adapters in `packages/project-store-sqlite`.

Copy the acyclic dependency direction used by `session-service` → repository port → SQLite adapter.

- [ ] Contract tests for CRUD, historical rows and audit writes.
- [ ] Enforce account↔person uniqueness and explicit claim state.
- [ ] Enforce overlapping active attendance-number uniqueness transactionally.
- [ ] Refuse removal of the last System Owner or Workspace Owner.
- [ ] Add cross-workspace BOLA and rollback tests.
- [ ] Return repositories from the existing `openSqliteStore` result.
- [ ] Commit: `feat(store): workspace directory repositories`.

### Task 5: Directory service

- [ ] Implement school/year/grade/class lifecycle.
- [ ] Implement Person, Enrollment and StaffAssignment create/update/end/archive operations.
- [ ] Put mutation and audit event in the same synchronous transaction.
- [ ] Use directory revision CAS for concurrent management edits.
- [ ] Commit: `feat(directory): school roster services with history`.

**Verification:** transfer/graduate/class-change keeps prior rows; failed audit write rolls back mutation; stale directory revision conflicts.

**Anti-pattern guards:** no destructive delete as normal workflow; no `await` inside repository transaction; no account requirement for Person creation.

## Phase 4 — Authentication, sessions and ownership

### Task 6: Decouple login from workspace

**Files:** `packages/auth-context`, `packages/session-service`, auth SQLite adapter and existing auth tests.

Copy the generic auth oracle, token verification, cookie rotation and membership-revocation fail-closed behavior from the accepted auth slice; replace only tenant binding.

- [ ] Change authenticated principal to stable account/user identity without permanent workspace.
- [ ] Link external identity to account, not organization.
- [ ] Make session user/account-scoped.
- [ ] First login creates personal workspace + owner membership atomically.
- [ ] Treat `hd` only as verified evidence for an explicit school join/claim.
- [ ] Replace immutable cross-`hd` tests with explicit multi-workspace tests.
- [ ] Keep all VerifyFailureCode, expiry, revocation, generic body, CSRF, Origin and cookie tests.
- [ ] Commit: `feat(auth): user sessions with explicit workspace access`.

### Task 7: System Owner bootstrap and transfer

- [ ] Implement hashed, one-time setup secret with atomic consume.
- [ ] Add hosted provisioning adapter boundary.
- [ ] Add owner transfer and last-owner protection.
- [ ] Prove two concurrent claims yield exactly one owner.
- [ ] Commit: `feat(access): safe system owner bootstrap`.

**Verification:** same teacher may hold system/workspace/class roles; selecting Teacher alone grants nothing; removed membership immediately fails resource access.

**Anti-pattern guards:** no first-web-request-wins bootstrap; no plaintext setup secret persistence/logging; no `hd`→admin auto-grant.

## Phase 5 — Management APIs and roster import

### Task 8: Hono management routes

**Files:** route module under `apps/r1-persist-server/src`; service wiring in bootstrap/server.

Copy Origin/CSRF/error mapping from existing state-changing project/auth routes.

- [ ] Workspace switch/list/create routes.
- [ ] School/year/grade/class routes.
- [ ] Person/enrollment/staff assignment routes.
- [ ] Permission and owner-transfer routes.
- [ ] Consistent 404 existence hiding across workspace boundaries.
- [ ] Body, field, page and rate limits.
- [ ] Commit: `feat(server): scoped workspace roster APIs`.

### Task 9: CSV preview and atomic apply

- [ ] Bounded upload and strict UTF-8/CSV parsing.
- [ ] Durable preview rows and deterministic `previewHash`.
- [ ] Diff categories from Design §8.
- [ ] Idempotent apply with directory base revision in one sync TX.
- [ ] Reject stale preview, duplicate people, ambiguous links and attendance collisions.
- [ ] Neutralize formula-leading cells on export.
- [ ] Concurrent apply, restart and all-or-nothing rollback tests.
- [ ] Commit: `feat(roster): previewed atomic CSV import`.

**Verification:** 40-row baseline and malformed/duplicate/large fixtures; no partial roster on any failure; audit coverage equals committed changes.

**Anti-pattern guards:** upload must not mutate roster; no row-by-row partial commits; no account auto-link from name/email.

## Phase 6 — Minimal management UI

### Task 10: Permission-gated management routes

**Files:** use the existing product web host if available after Scratch Task 10; otherwise create `apps/r1-management-web` without duplicating auth/session logic.

- [ ] Quick-start path creates/opens personal workspace without school questions.
- [ ] Teacher setup wizard: school → year → grade/class → roster.
- [ ] Roster table with history and account-link status.
- [ ] Staff/permissions page.
- [ ] CSV mapping, diff preview and apply confirmation.
- [ ] Advanced/system settings visible only with capability.
- [ ] Keyboard and 1280×720 acceptance.
- [ ] Commit: `feat(management): initial roster and permissions UI`.

**Verification:** Playwright covers one-person teacher setup and no-school quick start; unauthorized routes are rejected server-side, not merely hidden.

**Anti-pattern guards:** no separate mandatory enterprise onboarding; no API keys in browser storage; no UI-only authorization.

## Phase 7 — Project and asset integration

### Task 11: Workspace-aware projects and future Host role

**Files:** `packages/project-service`, `project-store-sqlite`, server routes and tests.

Copy atomic create and 404 existence-hiding patterns from the current project repository/access policy.

- [ ] Add explicit `workspaceId` and optional `classGroupId` to create.
- [ ] Derive workspace from resource for get/save/snapshot/restore/export.
- [ ] Migrate project role vocabulary to owner/host/editor/commenter/viewer.
- [ ] Preserve revision CAS and idempotency.
- [ ] Ensure a student may be assigned host without roster/system capabilities.
- [ ] Keep class-free project path green.
- [ ] Commit: `feat(projects): workspace scope and project host access`.

### Task 12: Asset/quota compatibility

- [ ] Key grants/quota checks to project workspace.
- [ ] Preserve legacy `organizationId` semantics inside frozen V1/V2 documents until an explicit envelope version changes it.
- [ ] Add migration and cross-workspace forged-SHA tests.
- [ ] Fix any actual FK target mismatch only in coordination with the active Scratch/SB3 branch.
- [ ] Commit: `feat(assets): workspace-scoped grants with legacy hash compatibility`.

**Verification:** prior duplicate-snapshot/restore, SB3 roundtrip, quota and BOLA tests remain green.

**Anti-pattern guards:** no global asset access by hash alone; no V1 rehash; do not overwrite uncommitted Scratch/SB3 work.

## Final phase — Acceptance, documentation and gates

### Task 13: Integrated acceptance and runbook

- [ ] Existing DB → migration → restart → unchanged project evidence.
- [ ] Same account: personal + casual + school workspaces.
- [ ] Roster Person before account; explicit link; no email auto-match.
- [ ] Teacher self-setup without municipality.
- [ ] Manual and CSV roster history across academic years.
- [ ] Student as Project Host, denied system/secret/roster capabilities.
- [ ] Personal/casual project without school/class.
- [ ] Membership/role revocation affects active session and WebSocket authorization.
- [ ] Cross-workspace BOLA and audit-event assertions.
- [ ] Update master roadmap and add `docs/r1/WORKSPACE_ROSTER.md` plus Go/No-Go evidence.

Run:

```text
pnpm build
pnpm gate0:test
pnpm r1:persist:test
pnpm r1:auth:test
pnpm r1:scratch:test
pnpm r1:directory:test
pnpm r1:workspace-roster:e2e
```

If a Scratch command is not yet present, record it as not applicable until that preceding slice lands; never use `--passWithNoTests`.

## Final anti-pattern scan

Fail the release if source outside legacy migrations/fixtures still contains any product assumption equivalent to:

- immutable Google subject → one organization
- authenticated principal permanently owns one organization
- email match → automatic person claim
- Teacher/Student → system permission
- project creation requires class
- roster schema without management API/UI
- V1 document rewritten from `organizationId` to `workspaceId`

## Execution gate

Implementation starts from the approved design and the Task 0 detailed plan. The Scratch/SB3 slice is complete at `1ad6812`. Existing dirty files belong to the current implementer and must not be overwritten.
