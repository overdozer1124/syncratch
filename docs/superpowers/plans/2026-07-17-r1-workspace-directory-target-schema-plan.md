# R1 Workspace Directory Target Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register additive SQLite migrations v2–v4 that create empty Workspace/Person/roster/access/import/audit tables matching the frozen domain contracts, without legacy backfill or production cutover.

**Architecture:** Extend the existing migration ledger registry with three immutable descriptors. Each migration's `apply` runs bare `CREATE TABLE` / unique-index / trigger DDL on the shared `better-sqlite3` connection inside the runner's per-version `BEGIN IMMEDIATE` transaction. Freeze the final v4 schema with a dedicated fingerprint JSON separate from the v1 baseline adoption fingerprints.

**Tech Stack:** TypeScript, pnpm, Vitest, better-sqlite3, existing migration runner/fingerprint helpers, frozen legacy-r1 fixture.

## Global Constraints

- Implement only additive DDL migrations and their tests. Do not backfill legacy rows.
- Do not alter populated legacy tables (`organizations`, `users`, `projects`, `sessions`, assets).
- Do not regenerate or modify `r1-baseline-fingerprints.json`.
- Do not implement deterministic Person ID generation, claim/setup-secret/rate-limit tables, repositories, auth cutover, APIs, or UI.
- Do not create FKs from `workspaces`/`user_accounts` to `organizations`/`users`.
- Project-scoped `role_assignments.project_id` may FK to legacy `projects(id)`.
- Migration callbacks are synchronous; no Promise, nested transaction, or second `Database()`.
- Copy the committed legacy fixture before verification; never open the source directly.
- Production non-migration sources must not read/write the new tables.
- Do not touch or stage `docs/ai-platform/`.
- Copy SQL DDL verbatim from
  `docs/superpowers/specs/2026-07-17-r1-workspace-directory-target-schema-design.md`
  §§5–7. Do not invent alternate column names or constraints.

---

## File Map

| Path | Responsibility |
|---|---|
| `packages/project-store-sqlite/src/migrations/0002-r1-identity-core.ts` | v2 descriptor + DDL |
| `packages/project-store-sqlite/src/migrations/0002-r1-identity-core.test.ts` | v2 contracts |
| `packages/project-store-sqlite/src/migrations/0003-r1-school-roster.ts` | v3 descriptor + DDL |
| `packages/project-store-sqlite/src/migrations/0003-r1-school-roster.test.ts` | v3 contracts |
| `packages/project-store-sqlite/src/migrations/0004-r1-access-import-audit.ts` | v4 descriptor + DDL + audit triggers |
| `packages/project-store-sqlite/src/migrations/0004-r1-access-import-audit.test.ts` | v4 contracts |
| `packages/project-store-sqlite/src/migrations/r1-target-schema-fingerprint.json` | Frozen final v4 fingerprint |
| `packages/project-store-sqlite/src/migrations/generate-r1-target-schema-fingerprint.ts` | Maintenance generator |
| `packages/project-store-sqlite/src/migrations/target-schema.test.ts` | Fresh/adopted/fingerprint/boundary contracts |
| `packages/project-store-sqlite/src/migrations/index.ts` | Production registry `[v1..v4]` |
| `packages/project-store-sqlite/package.json` | Fingerprint script |
| `packages/project-store-sqlite/src/migrations/adoption.test.ts` | Update production-registry expectations |
| `packages/project-store-sqlite/src/migrations/concurrency.test.ts` | Update race end-state to v4 |
| `packages/project-store-sqlite/src/workspace-migration-fixture.test.ts` | Update store reopen end-state to v4 |
| `docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md` | Mark ledger+target-schema progress |

---

### Task 1: Add immutable migration 0002 identity core

**Files:**
- Create: `packages/project-store-sqlite/src/migrations/0002-r1-identity-core.ts`
- Create: `packages/project-store-sqlite/src/migrations/0002-r1-identity-core.test.ts`

**Interfaces:**
- Consumes: `SchemaMigration`, `computeMigrationChecksum`, `configureSqliteConnection`
- Produces:

```ts
export const r1IdentityCoreChecksumSource: string;
export const r1IdentityCoreMigration: SchemaMigration;
```

- [ ] **Step 1: Write the failing tests**

Create `0002-r1-identity-core.test.ts`:

```ts
import Database from "better-sqlite3";
import {afterEach, describe, expect, it} from "vitest";
import {computeMigrationChecksum} from "./checksum.js";
import {configureSqliteConnection} from "./configure.js";
import {
  r1IdentityCoreChecksumSource,
  r1IdentityCoreMigration,
} from "./0002-r1-identity-core.js";

const dbs: Database.Database[] = [];

describe("0002 r1-identity-core", () => {
  afterEach(() => {
    for (const db of dbs.splice(0)) db.close();
  });

  it("has immutable version/name/checksum", () => {
    expect(r1IdentityCoreMigration.version).toBe(2);
    expect(r1IdentityCoreMigration.name).toBe("r1-identity-core");
    expect(r1IdentityCoreMigration.checksumSource).toBe(
      r1IdentityCoreChecksumSource,
    );
    expect(r1IdentityCoreMigration.checksum).toBe(
      computeMigrationChecksum(r1IdentityCoreChecksumSource),
    );
  });

  it("creates identity tables and rejects invalid active link duplicates", () => {
    const db = new Database(":memory:");
    dbs.push(db);
    configureSqliteConnection(db);
    r1IdentityCoreMigration.apply(db);

    for (const name of [
      "workspaces",
      "user_accounts",
      "people",
      "person_account_links",
      "workspace_memberships",
      "workspace_directory_revisions",
    ]) {
      expect(
        db
          .prepare(
            `SELECT 1 AS ok FROM sqlite_master WHERE type='table' AND name=?`,
          )
          .get(name),
      ).toBeTruthy();
    }

    db.exec(`
      INSERT INTO people(id, display_name, status, created_at, updated_at)
      VALUES ('p1','Ada','active','2026-07-17T00:00:00.000Z','2026-07-17T00:00:00.000Z');
      INSERT INTO user_accounts(id, status, created_at, updated_at)
      VALUES ('a1','active','2026-07-17T00:00:00.000Z','2026-07-17T00:00:00.000Z');
      INSERT INTO user_accounts(id, status, created_at, updated_at)
      VALUES ('a2','active','2026-07-17T00:00:00.000Z','2026-07-17T00:00:00.000Z');
      INSERT INTO person_account_links(id, person_id, account_id, status, linked_at, unlinked_at)
      VALUES ('l1','p1','a1','active','2026-07-17T00:00:00.000Z',NULL);
    `);

    expect(() =>
      db.exec(`
        INSERT INTO person_account_links(id, person_id, account_id, status, linked_at, unlinked_at)
        VALUES ('l2','p1','a2','active','2026-07-17T00:00:00.000Z',NULL);
      `),
    ).toThrow(/UNIQUE/);

    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      db
        .prepare(
          `SELECT sql FROM sqlite_master WHERE type='table' AND name='workspaces'`,
        )
        .pluck()
        .get() as string,
    ).not.toMatch(/REFERENCES\s+organizations/i);
  });
});
```

Also assert:

- active membership uniqueness on `(workspace_id, account_id)`;
- `status='active'` with non-null `ended_at` is rejected;
- empty trimmed ids rejected;
- no `REFERENCES users`.

- [ ] **Step 2: Run RED**

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/0002-r1-identity-core.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement migration**

Create `0002-r1-identity-core.ts`. Copy DDL verbatim from design §5 into one `db.exec(\`...\`)` (or sequential execs). Use this checksum source exactly:

```ts
export const r1IdentityCoreChecksumSource = [
  "version=2",
  "name=r1-identity-core",
  "createWorkspaces",
  "createUserAccounts",
  "createPeople",
  "createPersonAccountLinks",
  "createWorkspaceMemberships",
  "createWorkspaceDirectoryRevisions",
  "indexes:ux_pal_active_account,ux_pal_active_person,ux_wm_active,idx_pal_person,idx_pal_account,idx_wm_account,idx_wm_workspace",
].join("\n");
```

Compute the checksum with:

```text
node -e "console.log(require('node:crypto').createHash('sha256').update(<source>,'utf8').digest('hex'))"
```

Hard-code the resulting lowercase hex into `checksum`.

- [ ] **Step 4: GREEN + typecheck**

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/0002-r1-identity-core.test.ts
pnpm --filter @blocksync/project-store-sqlite typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/project-store-sqlite/src/migrations/0002-r1-identity-core.ts \
  packages/project-store-sqlite/src/migrations/0002-r1-identity-core.test.ts
git commit -m "feat(store): add identity core schema migration"
```

---

### Task 2: Add immutable migration 0003 school roster

**Files:**
- Create: `packages/project-store-sqlite/src/migrations/0003-r1-school-roster.ts`
- Create: `packages/project-store-sqlite/src/migrations/0003-r1-school-roster.test.ts`

**Interfaces:**
- Consumes: Task 1 migration (apply v2 before v3 in tests)
- Produces:

```ts
export const r1SchoolRosterChecksumSource: string;
export const r1SchoolRosterMigration: SchemaMigration;
```

- [ ] **Step 1: Write failing tests**

Cover:

1. version `3`, name `r1-school-roster`, checksum recomputation.
2. Apply v2 then v3 on `:memory:`; expected tables exist.
3. Composite FK: class_group with grade from another academic year fails.
4. Active attendance partial unique rejects two active rows with same number in one class.
5. Active person+class enrollment unique rejects duplicates.
6. `start_date > end_date` rejected.
7. `foreign_key_check` empty.

Do not register into production `index.ts` yet.

- [ ] **Step 2: RED**

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/0003-r1-school-roster.test.ts
```

- [ ] **Step 3: Implement**

Copy design §6 DDL verbatim. Checksum source:

```ts
export const r1SchoolRosterChecksumSource = [
  "version=3",
  "name=r1-school-roster",
  "createSchools",
  "createAcademicYears",
  "createGrades",
  "createClassGroups",
  "createEnrollments",
  "createStaffAssignments",
  "indexes:ux_enroll_active_attendance,ux_enroll_active_person_class,ux_staff_active_person_class_role,idx_schools_workspace,idx_ay_school,idx_grades_ay,idx_cg_ay,idx_cg_grade,idx_enroll_class,idx_enroll_person,idx_staff_class,idx_staff_person",
].join("\n");
```

Hard-code computed checksum.

- [ ] **Step 4: GREEN + typecheck**

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/0003-r1-school-roster.test.ts
pnpm --filter @blocksync/project-store-sqlite typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/project-store-sqlite/src/migrations/0003-r1-school-roster.ts \
  packages/project-store-sqlite/src/migrations/0003-r1-school-roster.test.ts
git commit -m "feat(store): add school roster schema migration"
```

---

### Task 3: Add immutable migration 0004 access/import/audit

**Files:**
- Create: `packages/project-store-sqlite/src/migrations/0004-r1-access-import-audit.ts`
- Create: `packages/project-store-sqlite/src/migrations/0004-r1-access-import-audit.test.ts`

**Interfaces:**
- Consumes: Task 1–2 migrations + baseline project schema for `projects` FK
- Produces:

```ts
export const r1AccessImportAuditChecksumSource: string;
export const r1AccessImportAuditMigration: SchemaMigration;
```

- [ ] **Step 1: Write failing tests**

Cover:

1. version `4`, name `r1-access-import-audit`, checksum recomputation.
2. Apply v1 baseline DDL helpers or v1 migration, then v2–v4, or apply project schema + v2–v4 as needed so `projects` exists before v4.
   Prefer:

```ts
import {r1BaselineMigration} from "./0001-r1-baseline.js";
import {r1IdentityCoreMigration} from "./0002-r1-identity-core.js";
import {r1SchoolRosterMigration} from "./0003-r1-school-roster.js";
// apply baseline, identity, roster, then under-test migration
```

3. Role scope/role CHECK rejects `scope_kind='system'` with `workspace_id` set and rejects `workspace` role `teacher`.
4. Active role uniqueness rejects duplicate active `(account, scope, role)`.
5. Roster import composite FK requires school belonging to the same workspace.
6. Invalid preview_hash / non-object `proposed_json` / non-array `issues_json` rejected.
7. Audit UPDATE and DELETE abort with append-only messages.
8. Project-scoped assignment with unknown `project_id` fails FK when projects table has no matching row.
9. `foreign_key_check` empty on empty tables after apply.

- [ ] **Step 2: RED**

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/0004-r1-access-import-audit.test.ts
```

- [ ] **Step 3: Implement**

Copy design §7 DDL + triggers verbatim. Checksum source:

```ts
export const r1AccessImportAuditChecksumSource = [
  "version=4",
  "name=r1-access-import-audit",
  "createRoleAssignments",
  "createRosterImports",
  "createRosterImportRows",
  "createAuditEvents",
  "triggers:audit_events_no_update,audit_events_no_delete",
  "indexes:ux_ra_active_unique,idx_ra_account_status,idx_ra_ws_role,idx_ra_sys_role,idx_ri_workspace,idx_ri_school,idx_rir_import,idx_audit_ws_time,idx_audit_subject",
].join("\n");
```

Hard-code computed checksum.

- [ ] **Step 4: GREEN + typecheck**

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/0004-r1-access-import-audit.test.ts
pnpm --filter @blocksync/project-store-sqlite typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/project-store-sqlite/src/migrations/0004-r1-access-import-audit.ts \
  packages/project-store-sqlite/src/migrations/0004-r1-access-import-audit.test.ts
git commit -m "feat(store): add access import and audit schema migration"
```

---

### Task 4: Freeze final v4 target schema fingerprint

**Files:**
- Create: `packages/project-store-sqlite/src/migrations/generate-r1-target-schema-fingerprint.ts`
- Create: `packages/project-store-sqlite/src/migrations/r1-target-schema-fingerprint.json`
- Create: `packages/project-store-sqlite/src/migrations/target-schema-fingerprint.test.ts`
- Modify: `packages/project-store-sqlite/package.json`

**Interfaces:**
- Consumes: `captureSchemaFingerprint`, v1–v4 migrations (imported directly, not via production index yet if still unregistered — import descriptors directly)
- Produces: committed JSON `{ "current": SchemaFingerprint }` for final v4 shape

- [ ] **Step 1: Write failing fingerprint test**

```ts
it("matches committed final fingerprint after applying v1-v4 on a temp db", () => {
  // apply four migrations on :memory: or temp file
  // expect(captureSchemaFingerprint(db)).toEqual(committed.current)
});

it("does not alter baseline adoption fingerprints file", async () => {
  // read r1-baseline-fingerprints.json and assert unchanged relative to git HEAD blob
  // or simply omit modifying it and assert file contents equal git show HEAD:...
});
```

Also assert the generated fingerprint includes `workspaces` and `audit_events` and still includes legacy `organizations`.

- [ ] **Step 2: RED**

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/target-schema-fingerprint.test.ts
```

- [ ] **Step 3: Implement generator and write JSON**

Generator:

1. Create temp directory DB.
2. `configureSqliteConnection`.
3. Apply `[r1BaselineMigration, r1IdentityCoreMigration, r1SchoolRosterMigration, r1AccessImportAuditMigration]` via `runSchemaMigrationsWithOptions` or sequential apply + ledger is optional for fingerprint capture of tables; prefer applying through the four `apply` methods after creating no ledger if fingerprint excludes `schema_migrations` already — **but** production end-state includes ledger. Capture after full runner with the four migrations so indexes/triggers match production.
4. Write pretty JSON `{ current: captureSchemaFingerprint(db) }`.
5. Clean temp dir in `finally`.
6. Never open committed `legacy-r1.sqlite`.

Add package script:

```json
"fixture:r1-target-schema-fingerprint": "tsx src/migrations/generate-r1-target-schema-fingerprint.ts --write"
```

Run the script to create the JSON.

- [ ] **Step 4: GREEN + typecheck + idempotent regenerate**

```text
pnpm --filter @blocksync/project-store-sqlite fixture:r1-target-schema-fingerprint
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/target-schema-fingerprint.test.ts
pnpm --filter @blocksync/project-store-sqlite typecheck
git diff -- packages/project-store-sqlite/src/migrations/r1-baseline-fingerprints.json
```

Expected: baseline fingerprints file has no diff.

- [ ] **Step 5: Commit**

```bash
git add packages/project-store-sqlite/src/migrations/generate-r1-target-schema-fingerprint.ts \
  packages/project-store-sqlite/src/migrations/r1-target-schema-fingerprint.json \
  packages/project-store-sqlite/src/migrations/target-schema-fingerprint.test.ts \
  packages/project-store-sqlite/package.json
git commit -m "feat(store): freeze target schema fingerprint"
```

---

### Task 5: Wire registry, update consumers, prove gates

**Files:**
- Modify: `packages/project-store-sqlite/src/migrations/index.ts`
- Create: `packages/project-store-sqlite/src/migrations/target-schema.test.ts`
- Modify: `packages/project-store-sqlite/src/migrations/adoption.test.ts`
- Modify: `packages/project-store-sqlite/src/migrations/concurrency.test.ts`
- Modify: `packages/project-store-sqlite/src/workspace-migration-fixture.test.ts`
- Modify: `docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md`

**Interfaces:**
- Produces production registry:

```ts
const migrations = [
  r1BaselineMigration,
  r1IdentityCoreMigration,
  r1SchoolRosterMigration,
  r1AccessImportAuditMigration,
] as const;
```

- [ ] **Step 1: Write / update failing integration tests first**

In `target-schema.test.ts`:

1. Fresh `:memory:` via `runSchemaMigrations` → versions `[1,2,3,4]`, `user_version=4`, fingerprint equals committed target, all new tables empty, FK check empty.
2. `copyLegacyR1Fixture` + production store/open path → same ledger end-state, new tables empty, logical manifest evidence unchanged except `databaseSha256`.
3. Fault on v3 and v4 both points → current version rolls back; prior versions remain; retry reaches final fingerprint.
4. Static boundary: walk `packages/project-store-sqlite/src/**/*.ts` excluding `migrations/` and `*.test.ts`; assert no matches for new table names (`workspaces`, `user_accounts`, `people`, `person_account_links`, `workspace_memberships`, `workspace_directory_revisions`, `schools`, `academic_years`, `grades`, `class_groups`, `enrollments`, `staff_assignments`, `role_assignments`, `roster_imports`, `roster_import_rows`, `audit_events`).

Update:

- `workspace-migration-fixture.test.ts`: expect `user_version === 4` and ledger `[1,2,3,4]`.
- `adoption.test.ts` production-registry cases: after adopt+advance, expect v4; keep unknown-reject and explicit `[r1BaselineMigration]` cases on v1 semantics.
- `concurrency.test.ts`: both children succeed; ledger has four rows; `user_version=4`; fingerprint equals target; FK empty; tables may now contain `workspaces` (empty is fine — assert existence or simply stop asserting absence). Replace “exactly one v1 ledger row” naming/assertions.

Roadmap Phase 2 Task 2:

- mark ledger-only and target-schema checklist items that this slice completes;
- keep Task 3+ backfill blocked until target-schema GO.

- [ ] **Step 2: RED**

```text
pnpm --filter @blocksync/project-store-sqlite test -- \
  src/migrations/target-schema.test.ts \
  src/migrations/adoption.test.ts \
  src/migrations/concurrency.test.ts \
  src/workspace-migration-fixture.test.ts
```

Expected: FAIL on v1-only end-state assertions / missing registry entries.

- [ ] **Step 3: Wire registry and fix tests**

Update `index.ts` imports/registry. Implement `target-schema.test.ts`. Adjust consumer tests only as required for production registry v4 end-state. Do not weaken unknown-legacy fail-closed tests.

- [ ] **Step 4: Final gates**

```text
pnpm --filter @blocksync/project-store-sqlite test
pnpm --filter @blocksync/project-store-sqlite typecheck
pnpm --filter @blocksync/workspace-directory test
pnpm --filter @blocksync/session-service test
pnpm r1:persist:test
pnpm r1:auth:test
git diff --check
```

Also verify:

```text
- no docs/ai-platform staged
- no legacy-r1.sqlite-wal / -shm
- legacy-r1.sqlite and legacy-r1.manifest.json unchanged
- r1-baseline-fingerprints.json unchanged
- fixture:legacy-r1 still produces user_version 0 with no schema_migrations
```

- [ ] **Step 5: Commit**

```bash
git add packages/project-store-sqlite/src/migrations/index.ts \
  packages/project-store-sqlite/src/migrations/target-schema.test.ts \
  packages/project-store-sqlite/src/migrations/adoption.test.ts \
  packages/project-store-sqlite/src/migrations/concurrency.test.ts \
  packages/project-store-sqlite/src/workspace-migration-fixture.test.ts \
  docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md
git commit -m "feat(store): register workspace directory target schema"
```

---

## Plan Completion Gate

- Production registry is `[1,2,3,4]` with immutable checksums.
- Fresh and copied-legacy databases reach version 4 with empty target tables.
- Final fingerprint matches committed JSON; baseline adoption fingerprints unchanged.
- CHECK / partial UNIQUE / composite FK / JSON / audit append-only contracts proven.
- Fault/retry and cross-process race proven for the extended registry.
- Production non-migration sources do not reference new tables.
- Frozen fixture evidence remains byte-stable except DB file SHA.
- All listed gates green; `docs/ai-platform/` unstaged.

After this plan is approved and implemented, create a separate design for legacy organization/user backfill (deterministic Person IDs + backup gate).
