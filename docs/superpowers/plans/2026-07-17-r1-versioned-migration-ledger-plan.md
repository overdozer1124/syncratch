# R1 Versioned SQLite Migration Ledger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an ordered, atomic, restartable SQLite migration ledger that safely adopts the accepted ledgerless R1 schema without creating Workspace or Person domain tables.

**Architecture:** `openSqliteStore` keeps one shared `better-sqlite3` connection, configures connection PRAGMAs before transactions, then runs one synchronous `BEGIN IMMEDIATE` transaction per migration. A strict generated schema fingerprint distinguishes empty, accepted-current, accepted-pre-generation, and unknown ledgerless databases; `schema_migrations` is authoritative and `PRAGMA user_version` is its checked mirror.

**Tech Stack:** TypeScript, pnpm, Vitest, better-sqlite3, Node.js child processes, existing frozen legacy fixture.

## Global Constraints

- Implement only migration infrastructure. Do not create `workspaces`, `people`, `user_accounts`, `person_account_links`, `workspace_memberships`, roster, permission, or audit tables.
- Do not edit, parse/reserialize, or rehash schemaVersion 1 project envelopes.
- Preserve all frozen manifest evidence and snapshot blob bytes.
- Keep `fixture:legacy-r1` capable of generating a ledgerless pre-migration
  database with `user_version = 0`; production startup alone uses the runner.
- Use only the shared `better-sqlite3` connection passed by `openSqliteStore`.
- Migration callbacks are synchronous; no Promise, `await`, nested transaction, or second `new Database()` inside a migration.
- Configure WAL, foreign keys, and busy timeout before `BEGIN IMMEDIATE`.
- `schema_migrations` is authoritative; `PRAGMA user_version` is only a checked mirror.
- Unknown/partial schemas, ledger gaps, history mismatches, and future versions fail closed without additional writes.
- Runtime automatic down migration is prohibited.
- Never open the committed source fixture directly; copy it before verification.
- Do not touch or stage `docs/ai-platform/`.

---

## File Map

| Path | Responsibility |
|---|---|
| `packages/project-store-sqlite/src/migrations/types.ts` | Migration descriptor, error codes, fingerprint types |
| `packages/project-store-sqlite/src/migrations/configure.ts` | Connection-only PRAGMAs |
| `packages/project-store-sqlite/src/migrations/checksum.ts` | SHA-256 migration checksum |
| `packages/project-store-sqlite/src/migrations/schema-fingerprint.ts` | Capture, compare, and classify ledgerless schemas |
| `packages/project-store-sqlite/src/migrations/r1-baseline-fingerprints.json` | Generated accepted current/pre-generation fingerprints |
| `packages/project-store-sqlite/src/migrations/generate-r1-baseline-fingerprints.ts` | Explicit maintenance generator; opens only a copied fixture |
| `packages/project-store-sqlite/src/migrations/0001-r1-baseline.ts` | Immutable baseline descriptor and fresh-schema callback |
| `packages/project-store-sqlite/src/migrations/runner.ts` | Ledger validation, atomic apply/adopt, fault seam |
| `packages/project-store-sqlite/src/migrations/index.ts` | Production exports and default registry |
| `packages/project-store-sqlite/src/migrations/*.test.ts` | Unit, adoption, rollback, and concurrency contracts |
| `packages/project-store-sqlite/src/migration-race-child.ts` | Cross-process migration race helper |
| `packages/project-store-sqlite/src/migrate.ts` | Split project DDL from connection configuration |
| `packages/project-store-sqlite/src/migrate-auth.ts` | Export auth DDL callback |
| `packages/project-store-sqlite/src/migrate-assets.ts` | Split asset DDL from known generation patch |
| `packages/project-store-sqlite/src/store.ts` | Configure, run migrations, close on startup failure |
| `packages/project-store-sqlite/src/index.ts` | Experimental migration exports |
| `packages/project-store-sqlite/src/workspace-migration-fixture.test.ts` | Frozen evidence after baseline adoption |
| `packages/project-store-sqlite/package.json` | Fingerprint maintenance script |
| `docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md` | Link Task 2 to this detailed plan |

---

### Task 1: Add migration types, errors, connection configuration, and checksums

**Files:**
- Create: `packages/project-store-sqlite/src/migrations/types.ts`
- Create: `packages/project-store-sqlite/src/migrations/configure.ts`
- Create: `packages/project-store-sqlite/src/migrations/checksum.ts`
- Create: `packages/project-store-sqlite/src/migrations/configure.test.ts`

**Interfaces:**
- Produces:

```ts
export type SchemaMigrationErrorCode =
  | "SCHEMA_UNKNOWN_LEGACY"
  | "SCHEMA_LEDGER_GAP"
  | "SCHEMA_LEDGER_MISMATCH"
  | "SCHEMA_VERSION_MISMATCH"
  | "SCHEMA_FUTURE_VERSION"
  | "SCHEMA_FOREIGN_KEY_VIOLATION"
  | "SCHEMA_BUSY";

export class SchemaMigrationError extends Error {
  readonly name = "SchemaMigrationError";
  constructor(
    readonly code: SchemaMigrationErrorCode,
    message: string,
    options?: ErrorOptions,
  );
}

export interface SchemaMigration {
  readonly version: number;
  readonly name: string;
  readonly checksumSource: string;
  readonly checksum: string;
  apply(db: Database.Database): void;
}

export interface ConfigureSqliteOptions {
  busyTimeoutMs?: number;
}

export function configureSqliteConnection(
  db: Database.Database,
  options?: ConfigureSqliteOptions,
): void;

export function computeMigrationChecksum(source: string): string;
```

- [ ] **Step 1: Write the failing connection and checksum tests**

Create `migrations/configure.test.ts`:

```ts
import Database from "better-sqlite3";
import {afterEach, describe, expect, it} from "vitest";
import {computeMigrationChecksum} from "./checksum.js";
import {configureSqliteConnection} from "./configure.js";
import {SchemaMigrationError} from "./types.js";

const dbs: Database.Database[] = [];

describe("migration primitives", () => {
  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
  });

  it("configures WAL, foreign keys and the bounded busy timeout without creating tables", () => {
    const db = new Database(":memory:");
    dbs.push(db);

    configureSqliteConnection(db);

    expect(db.pragma("journal_mode", {simple: true})).toBe("memory");
    expect(db.pragma("foreign_keys", {simple: true})).toBe(1);
    expect(db.pragma("busy_timeout", {simple: true})).toBe(5000);
    expect(
      db.prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
      ).all(),
    ).toEqual([]);
  });

  it("computes a stable lowercase SHA-256 checksum", () => {
    expect(computeMigrationChecksum("1\\0r1-baseline\\0create projects")).toBe(
      "7e43ccc54f0f9bf0a6aa530cde1a9139e92058d572840d9fbd4f0761480905be",
    );
  });

  it("returns a typed migration error without copying sensitive row data", () => {
    const error = new SchemaMigrationError(
      "SCHEMA_UNKNOWN_LEGACY",
      "table users differs",
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("SchemaMigrationError");
    expect(error.code).toBe("SCHEMA_UNKNOWN_LEGACY");
    expect(error.message).toBe("table users differs");
  });
});
```

Use a file-backed temporary database in one additional test to assert
`journal_mode === "wal"`; in-memory SQLite correctly reports `"memory"`.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/configure.test.ts
```

Expected: FAIL because the migration modules do not exist.

- [ ] **Step 3: Implement the primitives**

Create `types.ts`:

```ts
import type Database from "better-sqlite3";

export type SchemaMigrationErrorCode =
  | "SCHEMA_UNKNOWN_LEGACY"
  | "SCHEMA_LEDGER_GAP"
  | "SCHEMA_LEDGER_MISMATCH"
  | "SCHEMA_VERSION_MISMATCH"
  | "SCHEMA_FUTURE_VERSION"
  | "SCHEMA_FOREIGN_KEY_VIOLATION"
  | "SCHEMA_BUSY";

export class SchemaMigrationError extends Error {
  readonly name = "SchemaMigrationError";

  constructor(
    readonly code: SchemaMigrationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface SchemaMigration {
  readonly version: number;
  readonly name: string;
  readonly checksumSource: string;
  readonly checksum: string;
  apply(db: Database.Database): void;
}

export interface ConfigureSqliteOptions {
  busyTimeoutMs?: number;
}
```

Create `configure.ts`:

```ts
import type Database from "better-sqlite3";
import type {ConfigureSqliteOptions} from "./types.js";

export function configureSqliteConnection(
  db: Database.Database,
  options: ConfigureSqliteOptions = {},
): void {
  const busyTimeoutMs = options.busyTimeoutMs ?? 5000;
  if (!Number.isInteger(busyTimeoutMs) || busyTimeoutMs < 0) {
    throw new RangeError("busyTimeoutMs must be a non-negative integer");
  }
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma(`busy_timeout = ${busyTimeoutMs}`);
}
```

Create `checksum.ts`:

```ts
import {createHash} from "node:crypto";

export function computeMigrationChecksum(source: string): string {
  return createHash("sha256").update(source, "utf8").digest("hex");
}
```

Verify the committed expected literal independently:

```text
node -e "console.log(require('node:crypto').createHash('sha256').update('1\\0r1-baseline\\0create projects').digest('hex'))"
```

- [ ] **Step 4: Run focused tests and typecheck**

Run:

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/configure.test.ts
pnpm --filter @blocksync/project-store-sqlite typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/project-store-sqlite/src/migrations/types.ts \
  packages/project-store-sqlite/src/migrations/configure.ts \
  packages/project-store-sqlite/src/migrations/checksum.ts \
  packages/project-store-sqlite/src/migrations/configure.test.ts
git commit -m "feat(store): add migration primitives"
```

---

### Task 2: Freeze strict legacy schema fingerprints

**Files:**
- Create: `packages/project-store-sqlite/src/migrations/schema-fingerprint.ts`
- Create: `packages/project-store-sqlite/src/migrations/schema-fingerprint.test.ts`
- Create: `packages/project-store-sqlite/src/migrations/generate-r1-baseline-fingerprints.ts`
- Create: `packages/project-store-sqlite/src/migrations/r1-baseline-fingerprints.json`
- Modify: `packages/project-store-sqlite/package.json`

**Interfaces:**

```ts
export interface SchemaFingerprint {
  tables: Array<{
    name: string;
    sql: string;
    columns: Array<{
      cid: number;
      name: string;
      type: string;
      notNull: number;
      defaultValue: string | null;
      primaryKeyPosition: number;
    }>;
    foreignKeys: Array<{
      id: number;
      seq: number;
      table: string;
      from: string;
      to: string;
      onUpdate: string;
      onDelete: string;
      match: string;
    }>;
    indexes: Array<{
      name: string;
      unique: number;
      origin: string;
      partial: number;
      columns: string[];
    }>;
  }>;
}

export type LedgerlessSchemaClassification =
  | {kind: "empty"}
  | {kind: "current"}
  | {kind: "pre_generation"}
  | {kind: "unknown"; difference: string};

export function captureSchemaFingerprint(
  db: Database.Database,
): SchemaFingerprint;

export function classifyLedgerlessDatabase(
  db: Database.Database,
): LedgerlessSchemaClassification;
```

`captureSchemaFingerprint` excludes `schema_migrations` and `sqlite_%` tables,
sorts every collection deterministically, and normalizes SQL by trimming,
collapsing whitespace, and removing whitespace immediately inside
parentheses/around commas. The normalizer must scan SQL token-by-token and
preserve quoted string/identifier contents exactly; do not apply whitespace
regexes inside `'...'`, `"..."`, `` `...` ``, or `[...]`.

- [ ] **Step 1: Write the failing fingerprint contract**

Create tests that:

1. classify an empty in-memory DB as `empty`;
2. copy `legacy-r1.sqlite` with `copyLegacyR1Fixture`, open only the copy, and
   classify it as `current`;
3. remove `asset_gc_lock.generation` from a copied DB and classify it as
   `pre_generation`;
4. add `CREATE TABLE unexpected(id TEXT)` and classify it as `unknown`;
5. alter a CHECK-bearing table by recreate/copy/rename and classify it as
   `unknown`;
6. create `CHECK(label = 'a  b')` and prove normalization preserves the two
   spaces inside the quoted value;
7. call `captureSchemaFingerprint` twice and assert exact equality.

The current fixture test must begin:

```ts
const copied = copyLegacyR1Fixture(tempDir);
const db = new Database(copied.dbPath);
try {
  expect(classifyLedgerlessDatabase(db)).toEqual({kind: "current"});
} finally {
  db.close();
}
```

- [ ] **Step 2: Run the focused test and verify RED**

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/schema-fingerprint.test.ts
```

Expected: FAIL because fingerprint capture/classification is missing.

- [ ] **Step 3: Implement deterministic capture and comparison**

Implement `captureSchemaFingerprint` with these exact SQLite sources:

```sql
SELECT name, sql
FROM sqlite_master
WHERE type = 'table'
  AND name NOT LIKE 'sqlite_%'
  AND name <> 'schema_migrations'
ORDER BY name
```

For each table name, read with the quoted identifier:

```ts
const tableIdentifier = quoteIdentifier(table.name);
const columns = db.pragma(`table_info(${tableIdentifier})`);
const foreignKeys = db.pragma(`foreign_key_list(${tableIdentifier})`);
const indexes = db.pragma(`index_list(${tableIdentifier})`);
const indexColumns = db.pragma(
  `index_info(${quoteIdentifier(index.name)})`,
);
```

Never interpolate an unquoted identifier. Add:

```ts
function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
```

Map PRAGMA snake_case fields explicitly into `SchemaFingerprint`. Exclude
indexes whose `origin !== "c"` so SQLite autoindex names do not become
contracts. Compare fingerprints via a deterministic JSON representation and
return only the first structural path difference, for example:

```text
tables[3].columns[2].name: expected "generation", received "owner"
```

Do not include row values in the difference.

- [ ] **Step 4: Add the explicit fingerprint generator**

`generate-r1-baseline-fingerprints.ts` must:

1. require `--write`;
2. create a temporary root;
3. use `copyLegacyR1Fixture(tempRoot)` so the source DB is never opened;
4. capture `current`;
5. execute
   `ALTER TABLE asset_gc_lock DROP COLUMN generation` on the copied DB;
6. capture `preGeneration`;
7. write sorted pretty JSON to `r1-baseline-fingerprints.json`;
8. close every DB in `finally` and remove the temporary root.

The output shape is:

```ts
interface R1BaselineFingerprints {
  format: "blocksync.r1-schema-fingerprints/v1";
  current: SchemaFingerprint;
  preGeneration: SchemaFingerprint;
}
```

Add to `package.json`:

```json
"fixture:r1-schema-fingerprints": "tsx src/migrations/generate-r1-baseline-fingerprints.ts --write"
```

Run:

```text
pnpm --filter @blocksync/project-store-sqlite fixture:r1-schema-fingerprints
```

Load the JSON in `schema-fingerprint.ts` with a JSON import assertion and use
it for classification. The maintenance script is the only writer.

- [ ] **Step 5: Verify generated artifact and source hygiene**

Run:

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/schema-fingerprint.test.ts
pnpm --filter @blocksync/project-store-sqlite typecheck
git diff --check
```

Also assert no `legacy-r1.sqlite-wal` or `legacy-r1.sqlite-shm` exists.
Expected: PASS; generated JSON contains no row data, IDs, email, session hash,
envelope JSON, or snapshot content.

- [ ] **Step 6: Commit**

```bash
git add packages/project-store-sqlite/package.json \
  packages/project-store-sqlite/src/migrations/schema-fingerprint.ts \
  packages/project-store-sqlite/src/migrations/schema-fingerprint.test.ts \
  packages/project-store-sqlite/src/migrations/generate-r1-baseline-fingerprints.ts \
  packages/project-store-sqlite/src/migrations/r1-baseline-fingerprints.json
git commit -m "test(store): freeze accepted R1 schema fingerprints"
```

---

### Task 3: Define immutable baseline migration 0001

**Files:**
- Modify: `packages/project-store-sqlite/src/migrate.ts`
- Modify: `packages/project-store-sqlite/src/migrate-auth.ts`
- Modify: `packages/project-store-sqlite/src/migrate-assets.ts`
- Create: `packages/project-store-sqlite/src/migrations/0001-r1-baseline.ts`
- Create: `packages/project-store-sqlite/src/migrations/0001-r1-baseline.test.ts`

**Interfaces:**

```ts
export function createProjectSchema(db: Database.Database): void;
export function createAuthSchema(db: Database.Database): void;
export function createAssetSchema(db: Database.Database): void;
export function addAssetGcGenerationIfMissing(
  db: Database.Database,
): void;

export const r1BaselineMigration: SchemaMigration;
```

- [ ] **Step 1: Write the failing baseline descriptor tests**

Test:

```ts
expect(r1BaselineMigration.version).toBe(1);
expect(r1BaselineMigration.name).toBe("r1-baseline");
expect(
  computeMigrationChecksum(r1BaselineMigration.checksumSource),
).toBe(r1BaselineMigration.checksum);
```

Apply it inside `withImmediateTransaction` to a configured empty DB, then
assert:

- `captureSchemaFingerprint(db)` equals the committed `current` fingerprint;
- `PRAGMA foreign_key_check` is empty;
- `schema_migrations`, `workspaces`, `people`, `person_account_links`, and
  `workspace_memberships` are absent;
- `apply` returns `undefined`.

- [ ] **Step 2: Run the focused test and verify RED**

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/0001-r1-baseline.test.ts
```

Expected: FAIL because descriptor and schema callbacks do not exist.

- [ ] **Step 3: Split connection PRAGMAs from existing DDL**

Refactor without changing any `CREATE TABLE`, column order, CHECK, FK, or index
text. In `migrate.ts`, move the existing `db.exec` template literal into
`createProjectSchema` after deleting only the two leading PRAGMA statements.
Keep the public wrapper as:

```ts
export function migrate(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  createProjectSchema(db);
}
```

In `migrate-auth.ts`, move its existing complete `db.exec` template literal
into `createAuthSchema` after deleting only the leading foreign-key PRAGMA.
Keep the public wrapper as:

```ts
export function migrateAuth(db: Database.Database): void {
  db.pragma("foreign_keys = ON");
  createAuthSchema(db);
}
```

In `migrate-assets.ts`, move its existing complete `db.exec` template literal
into `createAssetSchema` after deleting only the leading foreign-key PRAGMA.
Move the existing `PRAGMA table_info(asset_gc_lock)` plus conditional
`ALTER TABLE` block, unchanged, into
`addAssetGcGenerationIfMissing`. Keep the public wrapper and helper boundary
as:

```ts
export function addAssetGcGenerationIfMissing(
  db: Database.Database,
): void {
  const columns = db.prepare("PRAGMA table_info(asset_gc_lock)").all()
    as Array<{name: string}>;
  if (!columns.some(column => column.name === "generation")) {
    db.exec(
      `ALTER TABLE asset_gc_lock
       ADD COLUMN generation INTEGER NOT NULL DEFAULT 1`,
    );
  }
}

export function migrateAssets(db: Database.Database): void {
  db.pragma("foreign_keys = ON");
  createAssetSchema(db);
  addAssetGcGenerationIfMissing(db);
}
```

The fingerprint test is the mechanical proof that the moved SQL remained
identical.

- [ ] **Step 4: Implement migration 0001**

Use this complete descriptor structure:

```ts
import type Database from "better-sqlite3";
import {createAuthSchema} from "../migrate-auth.js";
import {createAssetSchema} from "../migrate-assets.js";
import {createProjectSchema} from "../migrate.js";
import {computeMigrationChecksum} from "./checksum.js";
import type {SchemaMigration} from "./types.js";

export const r1BaselineChecksumSource = [
  "version=1",
  "name=r1-baseline",
  "createProjectSchema:v1",
  "createAuthSchema:v1",
  "createAssetSchema:v1-with-generation",
].join("\\n");

const checksum = computeMigrationChecksum(r1BaselineChecksumSource);

export const r1BaselineMigration: SchemaMigration = {
  version: 1,
  name: "r1-baseline",
  checksumSource: r1BaselineChecksumSource,
  checksum,
  apply(db: Database.Database): void {
    createProjectSchema(db);
    createAuthSchema(db);
    createAssetSchema(db);
  },
};
```

After implementation, replace computed assignment with a committed checksum
literal and retain the test that recomputes it:

```ts
checksum: "1b5519ca38da1711db8f7b7cc6da07ff55532471ee0934fa2fe0d5e2b2153362",
```

- [ ] **Step 5: Verify no schema drift**

Run:

```text
pnpm --filter @blocksync/project-store-sqlite test -- \
  src/migrations/0001-r1-baseline.test.ts \
  src/migrations/schema-fingerprint.test.ts
pnpm --filter @blocksync/project-store-sqlite typecheck
```

Expected: PASS. If fingerprint differs, restore the exact legacy DDL; do not
regenerate the accepted fingerprint to hide drift.

- [ ] **Step 6: Commit**

```bash
git add packages/project-store-sqlite/src/migrate.ts \
  packages/project-store-sqlite/src/migrate-auth.ts \
  packages/project-store-sqlite/src/migrate-assets.ts \
  packages/project-store-sqlite/src/migrations/0001-r1-baseline.ts \
  packages/project-store-sqlite/src/migrations/0001-r1-baseline.test.ts
git commit -m "feat(store): define immutable R1 baseline migration"
```

---

### Task 4: Implement the atomic migration runner and corruption guards

**Files:**
- Create: `packages/project-store-sqlite/src/migrations/runner.ts`
- Create: `packages/project-store-sqlite/src/migrations/index.ts`
- Create: `packages/project-store-sqlite/src/migrations/runner.test.ts`

**Interfaces:**

```ts
export type MigrationFaultPoint =
  | "after_apply_before_ledger"
  | "after_ledger_before_user_version";

interface MigrationRunnerTestOptions {
  migrations: readonly SchemaMigration[];
  now?: () => string;
  fault?: (
    point: MigrationFaultPoint,
    migration: SchemaMigration,
  ) => void;
}

export function runSchemaMigrations(
  db: Database.Database,
): void;

// Internal module export for adjacent tests only; do not re-export from package index.
export function runSchemaMigrationsWithOptions(
  db: Database.Database,
  options: MigrationRunnerTestOptions,
): void;
```

- [ ] **Step 1: Write RED tests for fresh apply and reopen**

Test an empty configured DB:

```ts
runSchemaMigrationsWithOptions(db, {
  migrations: [r1BaselineMigration],
  now: () => "2026-07-17T00:00:00.000Z",
});
expect(
  db.prepare(
    `SELECT version, name, checksum, applied_at
     FROM schema_migrations ORDER BY version`,
  ).all(),
).toEqual([{
  version: 1,
  name: "r1-baseline",
  checksum: r1BaselineMigration.checksum,
  applied_at: "2026-07-17T00:00:00.000Z",
}]);
expect(db.pragma("user_version", {simple: true})).toBe(1);
```

Inject the fixed `now` through `runSchemaMigrationsWithOptions`. Re-run and
assert the same row and timestamp remain unchanged.

- [ ] **Step 2: Verify RED**

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/runner.test.ts
```

Expected: FAIL because the runner does not exist.

- [ ] **Step 3: Implement registry validation and fresh apply**

Create the ledger inside the same transaction:

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY CHECK(version > 0),
  name TEXT NOT NULL UNIQUE,
  checksum TEXT NOT NULL
    CHECK(length(checksum) = 64
      AND checksum = lower(checksum)
      AND checksum NOT GLOB '*[^0-9a-f]*'),
  applied_at TEXT NOT NULL
)
```

Use these private helper boundaries in `runner.ts`:

```ts
function createLedgerTable(db: Database.Database): void;

function assertNoForeignKeyViolations(
  db: Database.Database,
  migration: SchemaMigration,
): void;

function recordAdoptedMigration(
  db: Database.Database,
  migration: SchemaMigration,
  appliedAt: string,
): void;

function applyAndRecordMigration(
  db: Database.Database,
  migration: SchemaMigration,
  appliedAt: string,
  fault?: MigrationRunnerTestOptions["fault"],
): void;
```

`recordAdoptedMigration` runs the FK check, inserts the immutable descriptor
and timestamp, then sets `user_version`. `applyAndRecordMigration` calls
`migration.apply`, invokes the first fault point, runs the FK check, inserts
the row, invokes the second fault point, then sets `user_version`.

Normalize optional test inputs once:

```ts
const migrations = options.migrations;
const now = options.now ?? (() => new Date().toISOString());
const fault = options.fault;
```

Validate the in-code registry before touching the DB:

- non-empty;
- starts at version 1;
- each next version is previous + 1;
- names unique;
- `checksum === computeMigrationChecksum(checksumSource)`.

Inside `withImmediateTransaction`, re-read ledger and `user_version`, validate
history, apply each pending migration, check FKs, insert the ledger row, and
set:

```ts
db.pragma(`user_version = ${migration.version}`);
```

Map a `SQLITE_BUSY`/`SQLITE_BUSY_TIMEOUT` raised by `BEGIN IMMEDIATE` to:

```ts
throw new SchemaMigrationError(
  "SCHEMA_BUSY",
  "Timed out waiting for the schema migration lock",
  {cause: error},
);
```

- [ ] **Step 4: Add RED corruption-guard tests**

Create valid v1 DBs, then independently mutate:

- delete v1 and insert only v2 → `SCHEMA_LEDGER_GAP`;
- change v1 name or checksum → `SCHEMA_LEDGER_MISMATCH`;
- set `user_version=0` with ledger v1 → `SCHEMA_VERSION_MISMATCH`;
- insert version 2 while registry max is 1 → `SCHEMA_FUTURE_VERSION`.

For every case, snapshot `schema_migrations` and `sqlite_master` before the
call and assert they are unchanged after rejection.

- [ ] **Step 5: Add RED rollback/retry tests**

Inject each fault point separately. After the thrown marker error, assert:

- no `schema_migrations` table;
- no baseline user tables;
- `user_version === 0`.

Then run without the fault and compare the final fingerprint/ledger to a
one-pass database.

- [ ] **Step 6: Implement the guards and fault seam**

Keep fault options in `runner.ts`; export them only from that internal module.
The production `migrations/index.ts` is:

```ts
import type Database from "better-sqlite3";
import {r1BaselineMigration} from "./0001-r1-baseline.js";
import {runSchemaMigrationsWithOptions} from "./runner.js";

const migrations = [r1BaselineMigration] as const;

export function runSchemaMigrations(db: Database.Database): void {
  runSchemaMigrationsWithOptions(db, {migrations});
}
```

After applying a migration:

```ts
const violations = db.prepare("PRAGMA foreign_key_check").all();
if (violations.length > 0) {
  throw new SchemaMigrationError(
    "SCHEMA_FOREIGN_KEY_VIOLATION",
    `Migration ${migration.version} produced foreign-key violations`,
  );
}
```

Do not include violation row values in the error.

- [ ] **Step 7: Verify Task 4**

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/runner.test.ts
pnpm --filter @blocksync/project-store-sqlite typecheck
git diff --check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/project-store-sqlite/src/migrations/runner.ts \
  packages/project-store-sqlite/src/migrations/index.ts \
  packages/project-store-sqlite/src/migrations/runner.test.ts
git commit -m "feat(store): run atomic versioned migrations"
```

---

### Task 5: Adopt accepted legacy schemas and wire store startup

**Files:**
- Modify: `packages/project-store-sqlite/src/migrations/runner.ts`
- Create: `packages/project-store-sqlite/src/migrations/adoption.test.ts`
- Modify: `packages/project-store-sqlite/src/store.ts`
- Modify: `packages/project-store-sqlite/src/index.ts`
- Modify: `packages/project-store-sqlite/src/workspace-migration-fixture.test.ts`
- Modify: `packages/project-store-sqlite/src/fixtures/legacy-r1-fixture.ts`
- Modify: `packages/project-store-sqlite/src/fixtures/legacy-r1-fixture.test.ts`

**Interfaces:**

```ts
export function runSchemaMigrations(db: Database.Database): void;
export function openLegacyR1StoreForFixture(
  options: SqliteStoreOptions,
): SqliteStore;
export {
  SchemaMigrationError,
  type SchemaMigration,
  type SchemaMigrationErrorCode,
} from "./migrations/types.js";
```

`openSqliteStore` keeps its existing public signature.
`openLegacyR1StoreForFixture` is a relative, package-internal fixture helper
and is not re-exported from `src/index.ts`.

- [ ] **Step 1: Write RED adoption tests**

Current fixture:

```ts
const copied = copyLegacyR1Fixture(tempDir);
const before = readLegacyR1Manifest(copied.dbPath, copied.snapshotDir);
const db = new Database(copied.dbPath);
try {
  configureSqliteConnection(db);
  runSchemaMigrations(db);
  expect(db.pragma("user_version", {simple: true})).toBe(1);
  expect(
    db.prepare("SELECT version, name FROM schema_migrations").all(),
  ).toEqual([{version: 1, name: "r1-baseline"}]);
} finally {
  db.close();
}
const after = readLegacyR1Manifest(copied.dbPath, copied.snapshotDir);
const {databaseSha256: _before, ...beforeEvidence} = before;
const {databaseSha256: _after, ...afterEvidence} = after;
expect(afterEvidence).toEqual(beforeEvidence);
```

Also assert the set of non-ledger tables, columns, FKs, and explicit indexes is
unchanged.

Pre-generation variant:

- copy the fixture;
- drop `asset_gc_lock.generation`;
- run migrations;
- assert only the generation column, ledger table, and user_version changed;
- reopen and assert no-op.

Unknown variants:

- extra table;
- missing table;
- extra column;
- changed CHECK;
- unknown explicit index.

For each, expect `SCHEMA_UNKNOWN_LEGACY`, no ledger table, no generation patch,
and `user_version=0`.

Add a builder regression to `legacy-r1-fixture.test.ts`. Open only the
temporary DB created by `createLegacyR1Fixture` and assert:

```ts
const schemaDb = new Database(paths.dbPath, {readonly: true});
try {
  expect(schemaDb.pragma("user_version", {simple: true})).toBe(0);
  expect(
    schemaDb.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name = 'schema_migrations'`,
    ).get(),
  ).toBeUndefined();
} finally {
  schemaDb.close();
}
```

This prevents future fixture regeneration from silently becoming a
post-migration database.

- [ ] **Step 2: Verify RED**

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/adoption.test.ts
```

Expected: FAIL because non-empty ledgerless databases are not adopted.

- [ ] **Step 3: Implement adoptive baseline**

Inside the first `BEGIN IMMEDIATE`, when no ledger exists:

```ts
const classification = classifyLedgerlessDatabase(db);
switch (classification.kind) {
  case "empty":
    createLedgerTable(db);
    applyAndRecordMigration(db, r1BaselineMigration, now(), fault);
    break;
  case "current":
    assertCurrentFingerprint(db);
    createLedgerTable(db);
    recordAdoptedMigration(db, r1BaselineMigration, now());
    break;
  case "pre_generation":
    addAssetGcGenerationIfMissing(db);
    assertCurrentFingerprint(db);
    createLedgerTable(db);
    recordAdoptedMigration(db, r1BaselineMigration, now());
    break;
  case "unknown":
    throw new SchemaMigrationError(
      "SCHEMA_UNKNOWN_LEGACY",
      `Legacy schema is not accepted: ${classification.difference}`,
    );
}
```

Classification must happen before creating the ledger table. Unknown schemas
must roll back with zero schema changes.

- [ ] **Step 4: Write RED startup-close test**

Create an unknown partial DB and call `openSqliteStore`. After rejection, open
the same path with a new `Database` and successfully obtain an immediate write
lock. This proves the failed store connection was closed.

- [ ] **Step 5: Wire `openSqliteStore` and exports**

Factor repository construction into one private helper that accepts a
synchronous initializer:

```ts
function openInitializedSqliteStore(
  options: SqliteStoreOptions,
  initialize: (db: Database.Database) => void,
): SqliteStore {
  const db = new Database(options.dbPath);
  try {
    initialize(db);
    const projectRepo = createSqliteProjectRepository(db);
    const authRepo = createSqliteAuthRepository(db);
    const assetRepo = createSqliteAssetRepository(db);
    const commitAssets = createSqliteCommitAssetGuard(db);
    const liveCatalog = createSqliteLiveAssetCatalog(db);
    return {
      projectRepo,
      authRepo,
      assetRepo,
      commitAssets,
      liveCatalog,
      close() {
        db.close();
      },
    };
  } catch (error) {
    db.close();
    throw error;
  }
}

export function openSqliteStore(options: SqliteStoreOptions): SqliteStore {
  return openInitializedSqliteStore(options, db => {
    configureSqliteConnection(db);
    runSchemaMigrations(db);
  });
}
```

Add this package-internal fixture-only opener:

```ts
export function openLegacyR1StoreForFixture(
  options: SqliteStoreOptions,
): SqliteStore {
  return openInitializedSqliteStore(options, db => {
    migrate(db);
    migrateAuth(db);
    migrateAssets(db);
  });
}
```

`openInitializedSqliteStore` must close the DB if its synchronous initializer
throws. Production passes an initializer that calls
`configureSqliteConnection` then `runSchemaMigrations`; the fixture helper
passes only the three legacy schema functions.

Change `createLegacyR1Fixture` to import the fixture helper by relative path
and use it instead of `openSqliteStore`. Do not expose the helper from package
`index.ts`.

Export production migration APIs from package `index.ts`. Keep legacy
`migrate`, `migrateAuth`, and `migrateAssets` exports temporarily for tests and
children, but do not call them from `openSqliteStore`.

Update `workspace-migration-fixture.test.ts` so the reopen path additionally
asserts:

```ts
expect(db.pragma("user_version", {simple: true})).toBe(1);
expect(
  db.prepare("SELECT version FROM schema_migrations").pluck().all(),
).toEqual([1]);
```

Do not open the source fixture to make these assertions.

- [ ] **Step 6: Run package and frozen-evidence verification**

```text
pnpm --filter @blocksync/project-store-sqlite test
pnpm --filter @blocksync/project-store-sqlite typecheck
git diff --check
```

Expected: all existing tests remain green; committed fixture and manifest
files are unmodified; source sidecars are absent.

- [ ] **Step 7: Commit**

```bash
git add packages/project-store-sqlite/src/migrations/runner.ts \
  packages/project-store-sqlite/src/migrations/adoption.test.ts \
  packages/project-store-sqlite/src/store.ts \
  packages/project-store-sqlite/src/index.ts \
  packages/project-store-sqlite/src/fixtures/legacy-r1-fixture.ts \
  packages/project-store-sqlite/src/fixtures/legacy-r1-fixture.test.ts \
  packages/project-store-sqlite/src/workspace-migration-fixture.test.ts
git commit -m "feat(store): adopt accepted legacy schema"
```

---

### Task 6: Prove concurrent startup and finalize the ledger slice

**Files:**
- Create: `packages/project-store-sqlite/src/migration-race-child.ts`
- Create: `packages/project-store-sqlite/src/migrations/concurrency.test.ts`
- Modify: `docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md`

**Interfaces:**
- Consumes: `configureSqliteConnection`, `runSchemaMigrations`
- Produces: cross-process migration acceptance evidence

- [ ] **Step 1: Write the failing busy-timeout test**

Use two connections to one temporary DB:

```ts
const owner = new Database(dbPath);
const contender = new Database(dbPath);
configureSqliteConnection(owner);
configureSqliteConnection(contender, {busyTimeoutMs: 25});
owner.exec("BEGIN IMMEDIATE");
try {
  expect(() => runSchemaMigrations(contender)).toThrowError(
    expect.objectContaining({code: "SCHEMA_BUSY"}),
  );
} finally {
  owner.exec("ROLLBACK");
  owner.close();
  contender.close();
}
```

Assert no user or ledger table was created by the contender.

- [ ] **Step 2: Write the failing cross-process race**

`migration-race-child.ts`:

```ts
import Database from "better-sqlite3";
import {configureSqliteConnection} from "./migrations/configure.js";
import {runSchemaMigrations} from "./migrations/index.js";

const dbPath = process.argv[2];
if (!dbPath) throw new Error("dbPath is required");
const db = new Database(dbPath);
try {
  configureSqliteConnection(db);
  runSchemaMigrations(db);
  process.stdout.write(`${JSON.stringify({ok: true})}\n`);
} finally {
  db.close();
}
```

Spawn two children concurrently using:

```ts
spawn(process.execPath, [
  "--import",
  "tsx",
  childPath,
  dbPath,
], {stdio: ["ignore", "pipe", "pipe"]});
```

Require both exits to be zero, then assert exactly one v1 ledger row,
`user_version=1`, current schema fingerprint, and no FK violations.

- [ ] **Step 3: Verify RED**

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/concurrency.test.ts
```

Expected: FAIL until busy errors are mapped and post-lock ledger re-read is
correct.

- [ ] **Step 4: Complete concurrency behavior**

Ensure `runSchemaMigrationsWithOptions`:

- acquires `BEGIN IMMEDIATE` before classifying or reading mutable ledger state;
- validates registry before lock acquisition but re-reads DB state after it;
- skips migration 1 when the winning process already committed it;
- maps only SQLite busy errors to `SCHEMA_BUSY`;
- never catches or remaps schema validation errors as busy errors.

- [ ] **Step 5: Update the roadmap**

In `2026-07-16-r1-workspace-roster-access-plan.md`:

- link Phase 2 Task 2 to this detailed plan;
- state that the ledger-only sub-slice precedes target Workspace schema;
- keep Tasks 3 onward blocked until ledger GO;
- record the approved deterministic Person ID strategy for the later schema
  plan without creating those tables here.

After the implementation commit, update the shared ledger at
`C:\cursor\NewScratchEditor\docs\CURSOR_CODEX_HANDOFF.md` in its owning
checkout. Do not copy or stage `docs/ai-platform/`.

- [ ] **Step 6: Run final gates**

```text
pnpm --filter @blocksync/project-store-sqlite test
pnpm --filter @blocksync/project-store-sqlite typecheck
pnpm --filter @blocksync/session-service test
pnpm r1:persist:test
pnpm r1:auth:test
git diff --check
```

Also verify:

```text
- no docs/ai-platform file is staged
- no legacy-r1.sqlite-wal or legacy-r1.sqlite-shm exists
- legacy-r1.sqlite and legacy-r1.manifest.json are unchanged
- fixture:legacy-r1 still produces user_version 0 with no schema_migrations
- migrations/ contains no `new Database(` outside test/generator/child files
- sqlite_master contains no Workspace/Person target tables
```

Expected: all PASS.

- [ ] **Step 7: Independent adversarial review**

Review against the shared Cursor rubric:

- primary evidence: ledger rows, `user_version`, exact fingerprints;
- adversarial question: can a partial/unknown/future DB be silently adopted?;
- failure paths: lock timeout, crash points, startup close;
- concurrency: lock acquisition followed by state re-read;
- scope: no target domain schema.

Fix every Critical/Important finding and repeat the review until GO.

- [ ] **Step 8: Commit**

```bash
git add packages/project-store-sqlite/src/migration-race-child.ts \
  packages/project-store-sqlite/src/migrations/concurrency.test.ts \
  docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md
git commit -m "test(store): prove concurrent migration startup"
```

---

## Plan Completion Gate

- Fresh and accepted ledgerless R1 databases both reach version 1.
- The accepted legacy fixture is adopted without changing frozen logical
  evidence or snapshot bytes.
- The pre-generation variant receives only its known patch.
- Unknown and partial schemas remain unmodified and fail closed.
- Ledger history, checksum, gap, future-version, and `user_version` guards are
  enforced.
- Every migration and ledger update is one synchronous transaction.
- Fault injection proves rollback and retry.
- Cross-process startup produces exactly one ledger row.
- Startup failure closes the SQLite handle.
- Existing auth/project/asset/GC behavior and all required gates remain green.
- No Workspace/Person target schema or behavior enters this slice.
- `docs/ai-platform/` remains unstaged.

After this plan is approved and implemented, create a separate design and plan
for the additive Workspace/Person schema. Do not backfill identities, projects,
memberships, or sessions before that next plan is approved.
