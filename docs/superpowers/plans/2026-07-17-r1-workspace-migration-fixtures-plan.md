# R1 Workspace Migration Fixtures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze a controlled pre-Workspace R1 database, snapshot files and row-level manifest so later migrations can prove that legacy identity, project, revision and snapshot data remain byte-stable.

**Architecture:** This plan is the first independently reviewable unit of the approved Workspace/Roster slice. It adds fixture-generation and read-only contract tooling only; it does not add `workspaces`, alter production migrations or change authentication. The committed fixture is created through current repository/service APIs, copied before each test, and compared by raw SQLite values and snapshot bytes rather than JSON reserialization.

**Tech Stack:** TypeScript, pnpm, Vitest, better-sqlite3, existing `@blocksync/project-service`, `@blocksync/session-service`, `@blocksync/project-snapshots-fs`.

## Global Constraints

- Do not edit or rehash schemaVersion 1 project envelopes.
- Do not hand-author the legacy SQLite schema or fixture rows.
- Do not mutate the committed fixture in place; copy it to a temporary directory before opening it.
- Use only obviously fictional fixture identity data under reserved `.example` domains; never derive this fixture from production or real user data.
- Preserve raw `project_revisions.envelope_json`, `content_hash`, `request_hash`, `client_transaction_id`, snapshot metadata and snapshot blob bytes.
- Generate auth rows through `AuthRepository.withTransaction`; generate projects/revisions/snapshots through `ProjectService`.
- Keep all tests green at each commit. The next migration plan, not this fixture plan, introduces the first failing production-migration test.
- Do not add `workspaces`, `people`, `PersonAccountLink` or a migration runner in this plan.
- Do not touch or stage `docs/ai-platform/`.

---

## File Map

| Path | Responsibility |
|---|---|
| `packages/project-store-sqlite/src/fixtures/legacy-r1-fixture.ts` | Deterministically create a legacy DB and snapshots through approved APIs |
| `packages/project-store-sqlite/src/fixtures/legacy-r1-manifest.ts` | Manifest types, raw-row extraction and SHA-256 helpers |
| `packages/project-store-sqlite/src/fixtures/legacy-r1.sqlite` | Committed pre-Workspace SQLite fixture |
| `packages/project-store-sqlite/src/fixtures/legacy-r1-snapshots/` | Committed snapshot blob bytes |
| `packages/project-store-sqlite/src/fixtures/legacy-r1.manifest.json` | Expected raw rows, hashes and mapping inputs |
| `packages/project-store-sqlite/src/fixtures/generate-legacy-r1-fixture.ts` | Explicit maintenance entry point |
| `packages/project-store-sqlite/src/workspace-migration-fixture.test.ts` | Copy/reopen/raw-byte contract tests |
| `packages/project-store-sqlite/package.json` | Fixture-generation script and `tsx` dev dependency |
| `pnpm-lock.yaml` | Lockfile update for direct `tsx` dev dependency |
| `docs/r1/WORKSPACE_ROSTER_MIGRATION.md` | Legacy-to-target migration matrix and fail-closed policies |

---

### Task 1: Add deterministic legacy fixture builder

**Files:**
- Create: `packages/project-store-sqlite/src/fixtures/legacy-r1-fixture.ts`
- Create: `packages/project-store-sqlite/src/fixtures/legacy-r1-manifest.ts`
- Create: `packages/project-store-sqlite/src/fixtures/legacy-r1-fixture.test.ts`

**Interfaces:**
- Consumes:
  - `openSqliteStore({dbPath}): SqliteStore`
  - `AuthRepository.withTransaction<T>(fn): T`
  - `createProjectService(deps): ProjectService`
  - `createFsSnapshotStore(root): SnapshotStore`
- Produces:

```ts
export interface LegacyFixturePaths {
  rootDir: string;
  dbPath: string;
  snapshotDir: string;
}

export interface LegacyR1Manifest {
  format: "blocksync.legacy-r1-fixture/v1";
  generatedAt: "2026-07-17T00:00:00.000Z";
  databaseSha256: string;
  snapshotSha256: Record<string, string>;
  organizations: Array<{id: string; name: string; status: string}>;
  users: Array<{id: string; primaryOrganizationId: string; status: string}>;
  externalIdentities: Array<{provider: string; subject: string; userId: string; organizationId: string}>;
  memberships: Array<{organizationId: string; userId: string; role: string}>;
  sessions: Array<{idHash: string; userId: string; organizationId: string; revokedAt: string | null}>;
  projects: Array<{id: string; organizationId: string; ownerUserId: string; headRevision: number}>;
  revisions: Array<{
    projectId: string;
    revision: number;
    envelopeJson: string;
    contentHash: string;
    requestHash: string;
    clientTransactionId: string | null;
  }>;
  snapshots: Array<{
    projectId: string;
    snapshotId: string;
    contentHash: string;
    storageKey: string;
  }>;
}

export async function createLegacyR1Fixture(paths: LegacyFixturePaths): Promise<LegacyR1Manifest>;
export function readLegacyR1Manifest(dbPath: string, snapshotDir: string): LegacyR1Manifest;
export function sha256File(path: string): string;
```

- [ ] **Step 1: Write the failing deterministic-builder test**

Create `legacy-r1-fixture.test.ts` with fixed IDs, time and expected row counts:

```ts
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {createLegacyR1Fixture} from "./legacy-r1-fixture.js";

const roots: string[] = [];

describe("legacy R1 fixture builder", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});
  });

  it("creates auth, project, revision and snapshot evidence through public APIs", async () => {
    const rootDir = mkdtempSync(join(tmpdir(), "legacy-r1-fixture-"));
    roots.push(rootDir);
    const manifest = await createLegacyR1Fixture({
      rootDir,
      dbPath: join(rootDir, "projects.sqlite"),
      snapshotDir: join(rootDir, "snapshots")
    });

    expect(manifest.organizations).toHaveLength(1);
    expect(manifest.organizations[0]).toMatchObject({
      name: "Legacy School",
      status: "active"
    });
    expect(manifest.users.map(row => row.id)).toEqual(["user-legacy-owner"]);
    expect(manifest.projects).toEqual([{
      id: "project-legacy-rich",
      organizationId: manifest.organizations[0].id,
      ownerUserId: "user-legacy-owner",
      headRevision: 1
    }]);
    expect(manifest.revisions.map(row => [row.revision, row.clientTransactionId])).toEqual([
      [0, null],
      [1, "tx-legacy-rich"]
    ]);
    expect(manifest.snapshots).toHaveLength(1);
    expect(Object.keys(manifest.snapshotSha256)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/fixtures/legacy-r1-fixture.test.ts
```

Expected: FAIL because `./legacy-r1-fixture.js` does not exist.

- [ ] **Step 3: Implement manifest extraction without parsing envelope JSON**

In `legacy-r1-manifest.ts`, use read-only SQL and map snake_case columns explicitly. The revision query must return `envelope_json` unchanged:

```ts
const revisions = db.prepare(`
  SELECT project_id, revision, envelope_json, content_hash, request_hash,
         client_transaction_id
  FROM project_revisions
  ORDER BY project_id, revision
`).all() as Array<{
  project_id: string;
  revision: number;
  envelope_json: string;
  content_hash: string;
  request_hash: string;
  client_transaction_id: string | null;
}>;

return revisions.map(row => ({
  projectId: row.project_id,
  revision: row.revision,
  envelopeJson: row.envelope_json,
  contentHash: row.content_hash,
  requestHash: row.request_hash,
  clientTransactionId: row.client_transaction_id
}));
```

Compute snapshot hashes from the exact files named by `project_snapshots.storage_key`. Do not call `JSON.parse` or `JSON.stringify` on `envelope_json`.
Open extraction connections with `new Database(dbPath, {readonly: true})` and close them in `finally`. `createLegacyR1Fixture` must close `SqliteStore` before reading the manifest or returning.

- [ ] **Step 4: Implement controlled fixture creation through approved APIs**

Use these fixed values:

```ts
const NOW = new Date("2026-07-17T00:00:00.000Z");
const USER_ID = "user-legacy-owner";
const PROJECT_ID = "project-legacy-rich";
const SESSION_ID_HASH = "a".repeat(64);
const CSRF_HASH = "b".repeat(64);
```

Create auth data through `store.authRepo.withTransaction`:

```ts
const organizationId = store.authRepo.withTransaction(tx => {
  const id = tx.ensureOrgForHostedDomain(
    "legacy.school.example",
    "Legacy School"
  );
  tx.createUser({
    userId: USER_ID,
    primaryOrganizationId: id,
    email: "owner@legacy.school.example",
    displayName: "Legacy Owner",
    now: NOW.toISOString()
  });
  tx.ensureMembership(id, USER_ID, "admin");
  tx.insertExternalIdentity({
    provider: "google",
    subject: "legacy-google-subject",
    userId: USER_ID,
    organizationId: id,
    createdAt: NOW.toISOString()
  });
  tx.createSession({
    idHash: SESSION_ID_HASH,
    userId: USER_ID,
    organizationId: id,
    csrfHash: CSRF_HASH,
    createdAt: NOW.toISOString(),
    expiresAt: "2026-07-18T00:00:00.000Z"
  });
  return id;
});
```

Use the returned `organizationId` for every dependent row. The committed manifest freezes the generated ID; later migrations compare against the manifest instead of assuming a particular UUID. Do not add fixture-only parameters to production repository ports.

Create the project with `ProjectService` using an `AuthContext` that returns `{userId: USER_ID, organizationId}`, fixed `now`, deterministic `idFactory`, and explicit `projectId`. Save `richFixtureDocument()` with transaction ID `tx-legacy-rich`, then create one snapshot.

- [ ] **Step 5: Run package tests and typecheck**

Run:

```text
pnpm --filter @blocksync/project-store-sqlite test
pnpm --filter @blocksync/project-store-sqlite typecheck
```

Expected: all PASS; the new fixture test reports one passing test.

- [ ] **Step 6: Commit**

```bash
git add packages/project-store-sqlite/src/fixtures/legacy-r1-fixture.ts \
  packages/project-store-sqlite/src/fixtures/legacy-r1-manifest.ts \
  packages/project-store-sqlite/src/fixtures/legacy-r1-fixture.test.ts
git commit -m "test(store): build legacy workspace migration fixture"
```

---

### Task 2: Generate and commit the immutable fixture

**Files:**
- Create: `packages/project-store-sqlite/src/fixtures/generate-legacy-r1-fixture.ts`
- Create: `packages/project-store-sqlite/src/fixtures/legacy-r1.sqlite`
- Create: `packages/project-store-sqlite/src/fixtures/legacy-r1-snapshots/<storage-key>.json`
- Create: `packages/project-store-sqlite/src/fixtures/legacy-r1.manifest.json`
- Modify: `packages/project-store-sqlite/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `createLegacyR1Fixture(paths)`
- Produces: `pnpm --filter @blocksync/project-store-sqlite fixture:legacy-r1`

- [ ] **Step 1: Add the explicit maintenance script**

The script must refuse to overwrite without `--write`:

```ts
if (!process.argv.includes("--write")) {
  throw new Error("Pass --write to replace the committed legacy R1 fixture");
}
```

Generate into a temporary directory, close SQLite, checkpoint WAL with `PRAGMA wal_checkpoint(TRUNCATE)`, then copy `projects.sqlite`, snapshot files and pretty-printed manifest to `src/fixtures`. Never generate during normal tests.

- [ ] **Step 2: Add package script and direct tool dependency**

Add alphabetically:

```json
{
  "scripts": {
    "fixture:legacy-r1": "tsx src/fixtures/generate-legacy-r1-fixture.ts --write"
  },
  "devDependencies": {
    "tsx": "^4.20.3"
  }
}
```

Run:

```text
pnpm install --lockfile-only
```

Expected: `pnpm-lock.yaml` records the package-level `tsx` importer; no unrelated upgrades.

- [ ] **Step 3: Generate the fixture once**

Run:

```text
pnpm --filter @blocksync/project-store-sqlite fixture:legacy-r1
```

Expected: creates `legacy-r1.sqlite`, exactly one snapshot blob and `legacy-r1.manifest.json`.

- [ ] **Step 4: Verify no WAL/SHM or plaintext session secret is committed**

Run:

```text
git status --short packages/project-store-sqlite/src/fixtures
rg -n "rawSessionId|rawCsrfToken|owner@legacy" packages/project-store-sqlite/src/fixtures/legacy-r1.manifest.json
```

Expected: no `-wal`/`-shm` files; manifest may contain the legacy user ID but must not contain raw session/CSRF values or email. Hashes and Google subject are intentional migration evidence.

- [ ] **Step 5: Commit**

```bash
git add packages/project-store-sqlite/package.json pnpm-lock.yaml \
  packages/project-store-sqlite/src/fixtures/generate-legacy-r1-fixture.ts \
  packages/project-store-sqlite/src/fixtures/legacy-r1.sqlite \
  packages/project-store-sqlite/src/fixtures/legacy-r1-snapshots \
  packages/project-store-sqlite/src/fixtures/legacy-r1.manifest.json
git commit -m "test(store): freeze accepted legacy R1 database"
```

---

### Task 3: Add copy/reopen and raw-byte contract tests

**Files:**
- Create: `packages/project-store-sqlite/src/workspace-migration-fixture.test.ts`
- Modify: `packages/project-store-sqlite/src/fixtures/legacy-r1-manifest.ts`

**Interfaces:**
- Produces:

```ts
export function copyLegacyR1Fixture(destinationRoot: string): {
  dbPath: string;
  snapshotDir: string;
  manifest: LegacyR1Manifest;
};
```

- [ ] **Step 1: Write the failing copy/reopen contract**

```ts
it("copies and reopens the committed fixture without mutating evidence", () => {
  const copied = copyLegacyR1Fixture(tempDir);
  const before = readLegacyR1Manifest(copied.dbPath, copied.snapshotDir);
  const store = openSqliteStore({dbPath: copied.dbPath});
  store.close();
  const after = readLegacyR1Manifest(copied.dbPath, copied.snapshotDir);

  expect(after.revisions).toEqual(before.revisions);
  expect(after.snapshots).toEqual(before.snapshots);
  expect(after.snapshotSha256).toEqual(before.snapshotSha256);
  expect(after.revisions.find(row => row.revision === 1)).toMatchObject({
    // Independent sentinel pinned by v1-envelope-hash.regression.test.ts.
    contentHash: "082c3d00ac85531a4e88689c13d1088137569a4fc5bc591b1797871c9cf13128",
    clientTransactionId: "tx-legacy-rich"
  });
});
```

Also assert `PRAGMA foreign_key_check` returns `[]`.
Assert neither the copied source directory nor destination contains `projects.sqlite-wal` or `projects.sqlite-shm` after all handles close.

- [ ] **Step 2: Run focused test and verify RED**

Run:

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/workspace-migration-fixture.test.ts
```

Expected: FAIL because `copyLegacyR1Fixture` is not exported.

- [ ] **Step 3: Implement recursive fixture copy**

Resolve source paths with `import.meta.url`, copy the DB and snapshot directory, parse only the manifest JSON, and return destination paths. Do not open the source DB.
Any verification query against the destination must use a read-only connection and close it in `finally`.

- [ ] **Step 4: Run package verification**

Run:

```text
pnpm --filter @blocksync/project-store-sqlite test
pnpm --filter @blocksync/project-store-sqlite typecheck
git diff --check
```

Expected: all tests and typecheck PASS; no whitespace errors.

- [ ] **Step 5: Commit**

```bash
git add packages/project-store-sqlite/src/fixtures/legacy-r1-manifest.ts \
  packages/project-store-sqlite/src/workspace-migration-fixture.test.ts
git commit -m "test(store): assert legacy migration evidence bytes"
```

---

### Task 4: Document the frozen migration matrix

**Files:**
- Create: `docs/r1/WORKSPACE_ROSTER_MIGRATION.md`
- Modify: `docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md`

**Interfaces:**
- Consumes: committed fixture and manifest from Tasks 1–3.
- Produces: an unambiguous input→target policy for the next schema/migration plan.

- [ ] **Step 1: Write the migration matrix**

Include this exact policy table:

| Legacy input | Target rule | Immutable evidence |
|---|---|---|
| `organizations.id` | Create `workspaces` row with identical ID; keep physical organization row during R1 | organization ID |
| `users` | Create one account and one Person/`PersonAccountLink`; Person ID strategy is fixed by the next schema plan | user ID and status |
| `organization_memberships` | Create equivalent workspace membership without adding roles | membership set |
| `external_identities` | Remove workspace binding only when account migration lands | `(provider, subject)` and user ID |
| `sessions` | Revoke or migrate fail-closed; never grant another workspace | session hash and revocation outcome |
| `projects.organization_id` | Backfill `workspace_id` with same value | project ID and owner |
| `project_revisions` | Never update rows | raw envelope JSON, hashes, transaction IDs |
| `project_snapshots` + blobs | Never rewrite | metadata and blob SHA-256 |
| asset grant/quota rows | Interpret legacy organization ID as workspace ID until explicit FK migration | SHA/grant set |

Document invalid-input policy:

- Missing organization/user referenced by a legacy project: migration aborts with actionable IDs; no synthetic identity is created.
- Session without valid membership: revoke fail-closed.
- Envelope `organizationId` differing from project tenant: migration aborts; do not rewrite envelope.
- Invalid legacy role: migration aborts; do not widen permission.

- [ ] **Step 2: Update the master roadmap**

In `2026-07-16-r1-workspace-roster-access-plan.md`:

- mark the design as approved at `3dda2b8`;
- link Task 0 to this detailed plan;
- replace `UserAccountLink` with the approved `PersonAccountLink`;
- state that Task 0 remains green and the first RED migration test begins in Task 2;
- retain Tasks 1–13 as the high-level execution roadmap.

- [ ] **Step 3: Self-review the documentation**

Run:

```text
rg -n "TBD|TODO|UserAccountLink|compatibility views" \
  docs/r1/WORKSPACE_ROSTER_MIGRATION.md \
  docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md
git diff --check
```

Expected: no placeholders, deprecated link name or compatibility-view requirement; no whitespace errors.

- [ ] **Step 4: Run final gates for this plan**

Run:

```text
pnpm --filter @blocksync/session-service test
pnpm --filter @blocksync/project-store-sqlite typecheck
pnpm --filter @blocksync/project-store-sqlite test
pnpm r1:persist:test
pnpm r1:auth:test
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/r1/WORKSPACE_ROSTER_MIGRATION.md \
  docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md
git commit -m "docs(r1): freeze workspace migration matrix"
```

---

## Plan Completion Gate

- The fixture was generated only through current repository/service APIs.
- The committed source fixture is never opened directly by tests.
- Raw V1 revision JSON, content hashes, request hashes, transaction IDs and snapshot bytes are pinned.
- No production schema or migration behavior changed.
- No Workspace/Person/account-link target implementation leaked into this fixture unit.
- `docs/ai-platform/` remains untracked and unstaged.

After this plan is complete and reviewed, write the next detailed plan for the versioned migration ledger and target Workspace schema. Do not begin directory services, auth cutover, roster claims, APIs or UI before that migration plan is approved.
