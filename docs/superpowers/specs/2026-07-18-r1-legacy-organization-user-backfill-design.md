# R1 Legacy Organization/User Backfill Design

**Date:** 2026-07-18
**Status:** Written design for review
**Predecessor:** [R1 Workspace Directory Target Schema](2026-07-17-r1-workspace-directory-target-schema-design.md)
**Roadmap:** [R1 Workspace Roster Access Plan, Phase 2 Task 3](../plans/2026-07-16-r1-workspace-roster-access-plan.md)

## 1. Goal

Add an immutable version 5 migration that converts every accepted R1 legacy
organization and user into the additive Workspace/Person model. The migration
must preserve tenant boundaries, create no broader role than the source grants,
revoke organization-bound sessions fail-closed, and leave V1 project evidence
unchanged.

A verified SQLite backup is mandatory immediately before a non-empty legacy
database enters the version 5 transaction.

## 2. Non-goals

This slice does not:

- delete or rename legacy tables;
- add `projects.workspace_id` or alter populated legacy tables;
- rewrite V1 envelope JSON, revisions, snapshots, assets, hashes, or
  transaction IDs;
- backfill school, academic year, grade, class, enrollment, staff, roster
  import, or audit rows;
- add claim, setup-secret, or rate-limit tables;
- implement repositories, API/UI changes, auth-principal cutover, or automatic
  backup retention;
- infer that a legacy organization is a school;
- merge people by email or external identity.

## 3. Frozen source and target boundaries

### 3.1 Source tables read by version 5

- `organizations`
- `organization_domains`
- `users`
- `organization_memberships`
- `external_identities`
- `sessions`
- `projects`
- `project_members`
- `project_revisions`
- `project_snapshots`
- legacy asset tables used by the frozen fixture evidence

The migration may update only `sessions.revoked_at`. Every other legacy value
is read-only.

### 3.2 Target tables written by version 5

- `workspaces`
- `user_accounts`
- `people`
- `person_account_links`
- `workspace_memberships`
- `workspace_directory_revisions`
- `role_assignments` for `workspace` and `project` scopes only

All v2-v4 DDL, descriptors, checksums, and the committed v4 target fingerprint
remain unchanged.

## 4. Registry and runner architecture

### 4.1 Registry

The production registry becomes:

```text
1 r1-baseline
2 r1-identity-core
3 r1-school-roster
4 r1-access-import-audit
5 r1-legacy-organization-user-backfill
```

Version 5 is a synchronous data migration. Its descriptor and checksum are
immutable after release.

### 4.2 Prepared migration lifecycle

The migration primitive gains a minimal synchronous preparation contract:

```ts
interface MigrationContext {
  appliedAt: string;
}

interface SchemaMigration {
  readonly version: number;
  readonly name: string;
  readonly checksumSource: string;
  readonly checksum: string;
  prepare?(db: Database.Database, context: MigrationContext): unknown;
  apply(
    db: Database.Database,
    context: MigrationContext,
    preparation?: unknown,
  ): void;
}
```

Existing migrations may continue to implement `apply(db)` and receive no
behavioral change.

For a migration with `prepare`, the runner executes:

1. Acquire `BEGIN IMMEDIATE`.
2. Validate registry, ledger, and `user_version`.
3. If the migration is already applied, commit and skip preparation.
4. Confirm that the migration is exactly the next version, then commit.
5. Run `prepare` synchronously outside a transaction. If another process
   completed version 5 before the backup snapshot began, preparation returns
   an `already_applied` result instead of a verified version 4 preparation.
6. Acquire a new `BEGIN IMMEDIATE`.
7. Revalidate registry, ledger, and `user_version`.
8. If another process applied the migration, commit and skip `apply`; the
   preparation artifact remains. Preparation, not the runner, performs any
   `.superseded-v5.sqlite` rename exactly once.
9. Otherwise pass the preparation result to `apply`.
10. Run the existing fault points, FK check, ledger insert, and
    `user_version` update in the same transaction.
11. Commit.

The runner calls `now()` once per invocation. That value is the single
`context.appliedAt` used by the backup filename, ended memberships and role
assignments, session revocation, and the ledger. Source-derived created,
updated, linked, and started timestamps do not use `appliedAt`.

### 4.3 TOCTOU closure

Version 5 preparation returns the verified backup path and the backup's
canonical legacy-data digest. The first operation in `apply`, while the second
`BEGIN IMMEDIATE` lock is held, recomputes the live digest and requires an exact
match.

If any legacy row changed after the backup snapshot, version 5 aborts before
writing target rows. A different process that already committed version 5 is
detected during preparation or by the second ledger check and causes a clean
skip.

## 5. Backup gate

### 5.1 Trigger

Preparation creates a backup only when:

- version 5 is pending;
- the connection is file-backed; and
- at least one row exists in `organizations`, `users`,
  `organization_memberships`, `sessions`, `projects`, or `project_members`.

Fresh databases and legacy-empty databases create no backup.

### 5.2 File policy

The backup is adjacent to the database:

```text
<database>.pre-v5.<UTC-milliseconds>.<unique-suffix>.sqlite
```

- Creation uses SQLite `VACUUM INTO` on the configured shared connection.
- The destination must not exist.
- The suffix prevents concurrent processes from selecting the same path.
- A backup is never overwritten, reused, or automatically deleted.
- Failed and race-loser preparations leave their backup as evidence.
- Backup files contain the same secrets and personal data as the database and
  inherit the database directory's access controls.

### 5.3 Verification

An independent readonly connection opens the backup after `VACUUM INTO`.
Preparation succeeds only when all checks pass:

1. `PRAGMA integrity_check` returns exactly `ok`.
2. `PRAGMA foreign_key_check` returns no rows.
3. `PRAGMA user_version` is exactly `4`.
4. `captureSchemaFingerprint` equals the committed v4 target fingerprint.
5. A canonical full-column digest of every legacy table equals the source
   digest captured for the same preparation.

The canonical digest:

- includes every column, including nullable and secret-bearing columns;
- uses a fixed table list and explicit deterministic row ordering;
- preserves SQLite value types and `NULL`;
- hashes stable UTF-8 JSON with SHA-256;
- excludes target rows, `schema_migrations`, page layout, WAL bytes, and the
  database file SHA.

The version 5 transaction compares this verified backup digest with a fresh
live digest under `BEGIN IMMEDIATE` before any DML.

There is one race-only branch: when the backup reports `user_version=5`,
preparation reads the live ledger. If and only if the live ledger contains the
exact registered version 5 name/checksum and `user_version=5`, preparation
renames the artifact with `.superseded-v5.sqlite` and returns
`already_applied`. It does not report `SCHEMA_BACKUP_FAILED`. Any other
unexpected version or ledger state remains a backup failure.

Backup creation or verification failure throws
`SCHEMA_BACKUP_FAILED`. A source validation or digest mismatch throws
`SCHEMA_BACKFILL_INVALID`. Both leave version 5 unapplied.

## 6. Deterministic identity

### 6.1 Namespace

All synthesized primary keys use RFC 9562 UUIDv5 with:

```text
R1_LEGACY_BACKFILL_NAMESPACE =
  5382ca4a-3efd-5013-bbff-25dc72876ebf
```

That namespace is UUIDv5 of the RFC URL namespace and:

```text
https://blocksync.dev/namespaces/r1-legacy-backfill
```

Names are encoded as UTF-8 without Unicode normalization or case conversion.
Legacy IDs are used byte-for-byte. Golden vectors freeze the namespace and
every name format.

### 6.2 Name formats

```text
person:
  legacy-user:<userId>

person/account link:
  legacy-link:<userId>

workspace membership:
  legacy-wm:<organizationId>:<userId>

workspace role assignment:
  legacy-ra-ws:<organizationId>:<userId>:<role>

project role assignment:
  legacy-ra-project:<projectId>:<userId>:<role>
```

Random target IDs are forbidden. Backup filenames may use a random suffix
because they are operational artifacts, not migrated domain identity.

## 7. Validation before writes

Version 5 performs a complete read-only validation pass before its first DML.
It aborts when:

- any source ID is empty after trimming;
- an organization name is empty after trimming;
- an organization status is not exactly `active` or `suspended`;
- a user status is not exactly `active` or `disabled`;
- a user references a missing primary organization;
- a user lacks membership in its primary organization;
- a membership references a missing organization or user;
- a project references a missing organization or owner user;
- a project owner is not a member of the project's organization;
- a project member is not a member of the project's organization;
- a project member role is not one of
  `owner`, `host`, `editor`, `commenter`, or `viewer`;
- a session references a missing or cross-tenant membership;
- existing target rows would conflict with the deterministic mapping;
- the verified backup digest differs from the locked live digest.

Foreign keys already reject several missing references. Explicit validation is
still required so tenant mismatch and unsupported-role failures are clear and
occur before target writes.

No invalid row is skipped, repaired heuristically, or converted into a
synthetic identity.

## 8. Data mapping

### 8.1 Workspaces

For every organization:

```text
workspaces.id         = organizations.id
workspaces.kind       = casual
workspaces.name       = trim(organizations.name)
workspaces.created_at = organizations.created_at
workspaces.updated_at = organizations.created_at
```

No FK is added between the two tables. `organization_domains` remains legacy
evidence and does not imply `kind=school`.

Each workspace receives:

```text
workspace_directory_revisions.revision   = 0
workspace_directory_revisions.updated_at = organizations.created_at
```

### 8.2 Accounts and people

For every user:

```text
user_accounts.id           = users.id
user_accounts.display_name = users.display_name
user_accounts.email        = users.email
user_accounts.status       = users.status
user_accounts.created_at   = users.created_at
user_accounts.updated_at   = users.updated_at
```

Person mapping:

```text
people.id = uuidv5(namespace, "legacy-user:" + users.id)
people.status = active   when users.status = active
people.status = disabled when users.status = disabled
people.created_at = users.created_at
people.updated_at = users.updated_at
```

`people.display_name` is the first non-empty trimmed value from:

1. `users.display_name`;
2. `users.email`;
3. literal `Legacy user`.

Each user creates one active link:

```text
person_account_links.id =
  uuidv5(namespace, "legacy-link:" + users.id)
status      = active
linked_at   = users.created_at
unlinked_at = NULL
```

Every legacy user maps to a separate Person. Email, provider subject, and
external identity are never used to merge people.

### 8.3 Workspace membership and role

Every legacy organization membership creates both:

- one `workspace_memberships` row; and
- one matching workspace-scope `role_assignments` row.

Role mapping is exact:

```text
admin  -> admin
member -> member
```

No workspace owner is synthesized.

`started_at` is the lexicographically later canonical UTC timestamp of
`organizations.created_at` and `users.created_at`. Canonical means exactly
`YYYY-MM-DDTHH:MM:SS.sssZ`, with three fractional-second digits. Accepted
legacy databases must use that format, so lexical and chronological ordering
are identical and the result cannot predate either the workspace or account.
A row is active only when both the organization and user are active. When the
organization is suspended or the user is disabled:

```text
status   = ended
ended_at = context.appliedAt
```

The workspace role assignment has the same role, status, start, and end
values as its membership.

### 8.4 Project role

For every project:

- `projects.owner_user_id` creates project role `owner`;
- an owner user's duplicate `project_members` row is normalized to that single
  owner assignment;
- non-owner project members retain an exact target project role;
- no role is promoted or inferred.

Project assignments are active only when the organization and user are active.
Suspended-organization and disabled-user assignments are ended at
`context.appliedAt`. Their `started_at` is the lexicographically later
canonical UTC timestamp of `projects.created_at` and `users.created_at`.

Owner normalization occurs before deterministic target-conflict detection.
The authoritative `projects.owner_user_id` row wins; its matching
`project_members` row does not count as a conflicting second target row.

Version 5 does not modify `projects` or add a workspace FK.

### 8.5 Sessions

All currently unrevoked legacy sessions are revoked:

```sql
UPDATE sessions
SET revoked_at = :appliedAt
WHERE revoked_at IS NULL;
```

Existing non-null revocation timestamps remain unchanged. There is no
account-scoped replacement session in this slice, so preserving an active
organization-bound session is forbidden.

## 9. Atomicity and retry

All target inserts and the session update occur in the normal version 5
`BEGIN IMMEDIATE` transaction. The existing two runner fault points must prove:

- target rows roll back;
- session revocation rolls back;
- no version 5 ledger row remains;
- `user_version` remains 4; and
- with the same injected clock, retry produces the same target IDs and row
  values as a one-shot migration. With a real clock, only
  `context.appliedAt`-derived ended/revoked/ledger timestamps and the
  operational backup filename may differ.

The backup remains after rollback. A retry creates and verifies a new backup.

## 10. Frozen evidence

Before and after version 5, tests compare:

- V1 envelope JSON bytes;
- revision content/request hashes;
- actor IDs, timestamps, and client transaction IDs;
- project and snapshot metadata;
- snapshot blob SHA-256;
- asset metadata and bytes;
- organization, domain, user, external identity, project, member, revision,
  snapshot, and asset rows.

The only permitted legacy logical difference is:

- previously null `sessions.revoked_at` becomes `context.appliedAt`.

The database file SHA changes and is not compared for equality.

## 11. Test strategy

### 11.1 Unit contracts

- UUIDv5 implementation and golden vectors for every name format;
- display-name fallback including null, empty, whitespace, and Unicode input;
- status and role mapping;
- canonical full-column legacy digest;
- backup filename format and no-overwrite behavior;
- immutable version 5 descriptor and checksum.

### 11.2 Integration contracts

Fresh database:

- reaches version 5 and ledger `[1,2,3,4,5]`;
- creates no backup;
- leaves all target rows empty.

Copied accepted fixture:

- never opens the committed fixture source directly;
- creates and verifies a pre-v5 backup;
- produces all expected deterministic rows;
- revokes only unrevoked sessions;
- preserves frozen evidence;
- has no FK violations.

Invalid-source matrix:

- cross-tenant project owner/member;
- unsupported project role;
- unsupported organization or user status;
- missing primary membership;
- empty source IDs or organization name;
- deterministic target conflict;
- session membership inconsistency.

Backup matrix:

- destination collision;
- `VACUUM INTO` failure;
- integrity, FK, version, schema fingerprint, and digest mismatch;
- locked-live digest mismatch after preparation.

Recovery and race:

- both existing runner fault points;
- retry equivalence;
- two-process startup produces one version 5 ledger row and no duplicate
  target row;
- concurrent backup files never overwrite each other.

### 11.3 Final gates

- `@blocksync/project-store-sqlite` full tests and typecheck;
- `@blocksync/workspace-directory` tests;
- `@blocksync/session-service` tests;
- `pnpm r1:persist:test`;
- `pnpm r1:auth:test`;
- fixture source, v1 baseline fingerprints, and v4 target fingerprint
  unchanged;
- no WAL/SHM sidecars beside committed fixtures;
- no `docs/ai-platform/` staged;
- `git diff --check`.

## 12. Acceptance criteria

The slice is complete only when:

1. Production registry is gapless `[1..5]`.
2. A non-empty accepted legacy database cannot enter version 5 without a
   verified backup.
3. Backup-to-live digest equality is rechecked under the version 5 write lock.
4. Every synthesized target ID is deterministic and covered by a golden
   vector.
5. No role is broadened and no Person is merged by email.
6. Suspended organizations and disabled users receive no active membership or
   role.
7. Every legacy active session is revoked atomically with the backfill.
8. Fresh, copied-fixture, invalid-source, backup-failure, fault/retry, and
   cross-process race tests pass.
9. V1 envelope, revision, snapshot, asset, and transaction evidence remains
   unchanged.
10. No repository, API, UI, claim, school, roster, or project-schema cutover is
    included.

## 13. Stop conditions

Stop implementation and return to design review if:

- `VACUUM INTO` cannot produce and verify an exact logical snapshot without
  changing the public store API;
- backup/live equality cannot be checked while the version 5 write lock is
  held;
- accepted production data contains a project role outside the frozen target
  role set;
- accepted production data contains an organization or user status outside
  the frozen source status sets;
- preserving an active legacy session is required;
- accepted source timestamps are not canonical UTC strings and therefore
  cannot be ordered deterministically;
- the migration would need to rewrite V1 envelope, revision, snapshot, asset,
  or project bytes;
- deterministic identity requires email matching or a non-frozen namespace.
