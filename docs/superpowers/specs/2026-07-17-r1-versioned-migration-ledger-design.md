# R1 Versioned SQLite Migration Ledger Design

> **Status:** Approved by user on 2026-07-17 — implementation not started
>
> **Parent design:** `docs/superpowers/specs/2026-07-16-r1-workspace-roster-access-design.md`
>
> **Frozen input:** `docs/superpowers/plans/2026-07-17-r1-workspace-migration-fixtures-plan.md`

## 1. Decision

The next independently reviewable R1 slice adds only a versioned SQLite
migration ledger and synchronous migration runner. It does not create
Workspace, Person, account-link, roster, or permission tables and does not
backfill legacy rows.

This separation proves schema evolution, crash recovery, legacy adoption, and
concurrent startup before any domain migration relies on them.

## 2. Goals

1. Replace unordered `CREATE TABLE IF NOT EXISTS` startup DDL with an ordered,
   monotonic migration runner.
2. Adopt the accepted ledgerless R1 schema without rewriting legacy data.
3. Apply each migration and its ledger record atomically on the existing shared
   `better-sqlite3` connection.
4. Detect schema drift, history edits, downgrade attempts, and partial schemas
   before repositories are constructed.
5. Preserve all frozen revision, snapshot, auth, project, and asset evidence.
6. Serialize concurrent process startup through SQLite locking.

## 3. Non-goals

- Creating `workspaces`, `people`, `user_accounts`,
  `person_account_links`, or `workspace_memberships`
- Migrating organizations, users, memberships, projects, or sessions
- Changing authentication principals, authorization, APIs, UI, or cookies
- Repointing or dropping legacy foreign keys or tables
- Rewriting schemaVersion 1 envelopes or hashes
- Runtime automatic down migrations
- Distributed locking across hosts or network filesystems

The later identity migration uses the following already approved decision:
`user_accounts.id` retains the legacy `users.id`, while `people.id` is derived
deterministically from a fixed namespace and the legacy user ID. This slice
records that decision but does not create either row.

## 4. Architecture

`openSqliteStore` remains the only database factory:

```text
new Database(dbPath)
  → configureSqliteConnection(db)
  → runSchemaMigrations(db)
  → construct repositories from db
```

`configureSqliteConnection` runs before any transaction and sets:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

`journal_mode` must not be changed inside a migration transaction.

The runner and migrations live under:

```text
packages/project-store-sqlite/src/migrations/
  index.ts
  types.ts
  schema-fingerprint.ts
  0001-r1-baseline.ts
```

The existing `migrate`, `migrateAuth`, and `migrateAssets` DDL is split so
connection PRAGMAs are not mixed with schema creation. Existing exports may
remain as temporary compatibility wrappers, but `openSqliteStore` invokes only
the versioned runner.

No migration opens a second SQLite connection. Migration callbacks are
synchronous and may not return a Promise or start a nested transaction.

## 5. Ledger contract

The runner creates:

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY CHECK(version > 0),
  name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL
    CHECK(length(checksum) = 64
      AND checksum = lower(checksum)
      AND checksum NOT GLOB '*[^0-9a-f]*'),
  applied_at TEXT NOT NULL
);
```

Each code migration has this immutable descriptor:

```ts
interface SchemaMigration {
  readonly version: number;
  readonly name: string;
  readonly checksum: string;
  apply(db: Database.Database): void;
}
```

Versions start at 1 and are strictly increasing and gapless. Names are unique.
The checksum is a committed lowercase SHA-256 over an exported immutable
`checksumSource` string containing the version, name, and ordered schema
operations. Tests recompute it. Changing an applied operation requires a new
version; editing an existing checksum or descriptor is a startup error.

`schema_migrations` is the source of truth. `PRAGMA user_version` mirrors the
largest applied version and is never independently advanced.

At startup the runner validates:

- every ledger row matches a known migration's version, name, and checksum;
- versions are gapless from 1;
- `user_version` equals the largest ledger version, or 0 for an empty ledger;
- the database does not contain a version newer than this binary knows.

Any mismatch fails closed without applying another migration.

Runtime code never updates or deletes a ledger row.

## 6. Baseline classification and adoption

The first `BEGIN IMMEDIATE` classifies a ledgerless database before changing
its schema.

### 6.1 Empty database

A database with no non-internal tables is fresh. Migration 1 creates the
accepted current R1 project, auth, session, asset, quota, and GC schema,
creates the ledger row, and sets `user_version = 1` in one transaction.

### 6.2 Accepted legacy database

A ledgerless non-empty database is adopted only if it matches one of two
explicit fingerprints:

1. the accepted current R1 schema frozen by `legacy-r1.sqlite`;
2. the same schema before `asset_gc_lock.generation` was added.

The fingerprint verifies:

- the exact set of non-internal table names;
- every column's name, declared type, nullability, default, and primary-key
  position;
- foreign-key rows;
- explicit index names, uniqueness, and ordered columns;
- normalized `sqlite_master.sql` fragments needed to pin CHECK constraints.

Unexpected tables, missing tables, extra columns, altered constraints, or
unknown indexes reject adoption. A table name alone is never sufficient.

For the pre-generation variant, the known `ALTER TABLE` patch runs inside the
baseline transaction. The runner then validates the current fingerprint,
inserts migration 1 as adopted, and sets `user_version = 1`.

The accepted current variant is not rebuilt and no legacy data row is updated.

### 6.3 Unknown or partial database

An unknown or partially-created schema raises a typed migration error. The
transaction rolls back, leaving no ledger table, patch, or additional DDL.
The error reports the first actionable fingerprint difference without
including row data or secrets.

## 7. Atomic execution and concurrent startup

Each version uses this sequence on the shared connection:

```text
BEGIN IMMEDIATE
  → re-read and validate ledger + user_version after lock acquisition
  → apply one migration synchronously when still pending
  → PRAGMA foreign_key_check; require zero rows
  → INSERT schema_migrations row
  → PRAGMA user_version = <version>
COMMIT
```

On any error, the runner attempts `ROLLBACK` and rethrows the original error.
SQLite transactional DDL and WAL recovery ensure a version is either fully
applied and recorded or absent.

Two processes may open the same local database concurrently. The second waits
up to 5 seconds for `BEGIN IMMEDIATE`, re-reads the ledger after acquiring the
lock, and skips work completed by the first. A lock timeout fails without a
schema write. No distributed lock is added.

`openSqliteStore` closes the database if configuration or migration throws.

## 8. Errors

Migration failures use a dedicated `SchemaMigrationError` with stable internal
codes:

```ts
type SchemaMigrationErrorCode =
  | "SCHEMA_UNKNOWN_LEGACY"
  | "SCHEMA_LEDGER_GAP"
  | "SCHEMA_LEDGER_MISMATCH"
  | "SCHEMA_VERSION_MISMATCH"
  | "SCHEMA_FUTURE_VERSION"
  | "SCHEMA_FOREIGN_KEY_VIOLATION"
  | "SCHEMA_BUSY";
```

Messages include migration version/name or structural object names where
useful, but never database row values, session hashes, emails, or envelope
content.

## 9. Recovery and rollback policy

The project uses forward repair plus operational backup, not runtime down
migrations.

- A failed transaction is retried on reopen from the last recorded version.
- A binary older than the database fails closed and does not downgrade it.
- Baseline migration 1 is additive or adoptive and does not require an
  automatic backup.
- Every later data-transforming or contract migration plan must include a
  verified pre-migration SQLite backup gate and a forward repair procedure.
- Destructive schema changes are not allowed in this slice.

## 10. Acceptance tests

### 10.1 Fresh and reopen

- Opening an empty database produces all accepted R1 tables,
  `schema_migrations` version 1, and `user_version = 1`.
- `PRAGMA foreign_key_check` returns no rows.
- Reopening performs no DDL and leaves the ledger unchanged.

### 10.2 Frozen legacy fixture

- Tests copy the committed fixture and never open the source database.
- Adoption creates only ledger metadata and `user_version`.
- Before/after manifest evidence is identical except database file SHA-256.
- Raw revision envelopes, content/request hashes, transaction IDs, actors,
  timestamps, snapshot metadata, and snapshot blob hashes remain unchanged.
- No source `-wal` or `-shm` file appears.

### 10.3 Known old variant

- A database matching the pre-`generation` fingerprint receives only the known
  column patch and baseline record.
- Reopen is a no-op.

### 10.4 Failure and retry

Fault injection after schema operations, before ledger insertion, and before
`user_version` update proves complete rollback. Reopening without the injected
fault reaches the same state as a one-pass migration.

### 10.5 Corruption guards

Tests reject, without further writes:

- unknown or partial legacy schemas;
- ledger gaps;
- changed migration names or checksums;
- ledger and `user_version` disagreement;
- a database version newer than the binary.

### 10.6 Concurrency

- Two connections racing on one database produce exactly one version-1 row.
- A child-process race proves the same result across processes.
- The loser either observes the completed migration or returns `SCHEMA_BUSY`
  after the bounded wait.

### 10.7 Resource and scope guards

- Configuration or migration failure closes the SQLite handle.
- No SQLite sidecar is committed.
- This slice creates no Workspace, Person, account-link, membership, roster,
  permission, or audit table.
- Existing auth, project, session, asset, and GC behavior remains unchanged.

Required gates:

```text
pnpm --filter @blocksync/project-store-sqlite test
pnpm --filter @blocksync/project-store-sqlite typecheck
pnpm --filter @blocksync/session-service test
pnpm r1:persist:test
pnpm r1:auth:test
git diff --check
```

## 11. Stop conditions

Stop and reject the implementation if it:

- opens a second connection to apply migrations;
- runs asynchronous work inside a migration transaction;
- treats `CREATE TABLE IF NOT EXISTS` success as legacy compatibility proof;
- adopts an unknown schema;
- records a migration separately from its DDL;
- edits or reserializes frozen project/snapshot evidence;
- creates target Workspace/Person domain tables in this slice;
- provides automatic downgrade behavior;
- leaves an open database handle after startup failure.

## 12. Follow-on slice

After this ledger slice is approved, the next design may add the additive
Workspace and Person schema. It must use deterministic Person IDs derived from
a fixed namespace plus legacy user ID, retain legacy user IDs as UserAccount
IDs, and remain unread by production authorization until its own migration and
backfill acceptance tests pass.
