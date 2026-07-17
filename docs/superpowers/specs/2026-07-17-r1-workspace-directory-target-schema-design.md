# R1 Workspace Directory Target Schema Design

> **Status:** Approved by user on 2026-07-17 — implementation not started
>
> **Approval basis:** brainstorming sections approved in-session; user directed
> plan execution to completion
>
> **Parent designs:**
> - `docs/superpowers/specs/2026-07-16-r1-workspace-roster-access-design.md`
> - `docs/superpowers/specs/2026-07-17-r1-workspace-directory-domain-contracts-design.md`
> - `docs/superpowers/specs/2026-07-17-r1-versioned-migration-ledger-design.md`
>
> **Prior slice (frozen):** Workspace Directory Domain Contracts @
> `76be558eb13ee35835a5aed1845f562deb356318`
>
> **Roadmap:** Phase 2 Task 2 target-schema half of
> `docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md`

## 1. Decision

The next independently reviewable R1 slice adds additive SQLite migrations
`version 2`–`4` that create the Workspace/Person/roster/access/import/audit
tables matching the frozen `@blocksync/workspace-directory` contracts.

This slice:

- creates empty tables only (no legacy row backfill);
- leaves production repositories, auth, and APIs reading only legacy tables;
- does not implement deterministic Person ID generation;
- does not create roster-claim, claim rate-limit, or System Owner setup-secret
  tables (deferred to Phase 4 / v5+ after those contracts freeze).

## 2. Goals

1. Register gapless migrations `2`, `3`, and `4` on the existing shared
   `better-sqlite3` connection and migration ledger.
2. Encode domain models as SQL with closed enum CHECKs, history end-field
   consistency, partial unique indexes, and composite FKs where SQLite can
   enforce them.
3. Keep baseline adoption fingerprints frozen at v1; new tables arrive only
   after v1 is applied or adopted.
4. Prove fresh and copied-legacy databases both reach `user_version = 4` with
   empty new tables and unchanged frozen evidence.
5. Keep production code from reading or writing the new tables until a later
   cutover slice.

## 3. Non-goals

- Migrating organizations, users, memberships, projects, sessions, or assets
- Altering populated legacy tables (no `projects.workspace_id`, no FK rewrites)
- Deterministic Person ID algorithm, namespace UUID, or golden vectors
- Repository ports/adapters, directory services, Hono routes, or UI
- Auth principal cutover or session migration
- Roster claim codes, claim rate limits, System Owner setup secrets
- Runtime down migrations
- Regenerating `r1-baseline-fingerprints.json`

## 4. Architecture

```text
openSqliteStore
  → configureSqliteConnection
  → runSchemaMigrations([v1, v2, v3, v4])
  → construct legacy repositories only
```

Registry order:

```text
packages/project-store-sqlite/src/migrations/
  0001-r1-baseline.ts                 // frozen
  0002-r1-identity-core.ts            // version 2
  0003-r1-school-roster.ts            // version 3
  0004-r1-access-import-audit.ts      // version 4
  r1-target-schema-fingerprint.json   // final v4 fingerprint (new)
  generate-r1-target-schema-fingerprint.ts
```

Each descriptor follows the existing `SchemaMigration` contract:

- gapless integer `version`
- unique immutable `name`
- newline-joined `checksumSource`
- lowercase SHA-256 `checksum` matching `computeMigrationChecksum`
- synchronous `apply(db)` using only the shared connection

DDL uses bare `CREATE TABLE` / `CREATE UNIQUE INDEX` (no `IF NOT EXISTS`) so
drift cannot hide behind idempotent creates. Non-unique lookup indexes may use
`CREATE INDEX IF NOT EXISTS` to match existing project/auth conventions.

`r1-baseline-fingerprints.json` remains the ledgerless-adoption oracle and must
not include v2–v4 tables. Final schema shape after v4 is frozen separately in
`r1-target-schema-fingerprint.json`.

## 5. Migration v2 — identity core

**Name:** `r1-identity-core`

**Version:** `2`

### 5.1 Tables

```sql
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  kind TEXT NOT NULL CHECK (kind IN ('personal','casual','school')),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE user_accounts (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  display_name TEXT,
  email TEXT,
  status TEXT NOT NULL CHECK (status IN ('active','disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE people (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) > 0),
  status TEXT NOT NULL CHECK (status IN ('active','disabled','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE person_account_links (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  person_id TEXT NOT NULL REFERENCES people(id),
  account_id TEXT NOT NULL REFERENCES user_accounts(id),
  status TEXT NOT NULL CHECK (status IN ('active','unlinked')),
  linked_at TEXT NOT NULL,
  unlinked_at TEXT,
  CHECK (
    (status = 'active' AND unlinked_at IS NULL)
    OR (status = 'unlinked' AND unlinked_at IS NOT NULL)
  )
);

CREATE TABLE workspace_memberships (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  account_id TEXT NOT NULL REFERENCES user_accounts(id),
  role TEXT NOT NULL CHECK (role IN ('owner','admin','member','guest')),
  status TEXT NOT NULL CHECK (status IN ('active','ended')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  CHECK (
    (status = 'active' AND ended_at IS NULL)
    OR (status = 'ended' AND ended_at IS NOT NULL)
  )
);

CREATE TABLE workspace_directory_revisions (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at TEXT NOT NULL
);
```

### 5.2 Indexes

```sql
CREATE UNIQUE INDEX ux_pal_active_account
  ON person_account_links(account_id) WHERE status = 'active';

CREATE UNIQUE INDEX ux_pal_active_person
  ON person_account_links(person_id) WHERE status = 'active';

CREATE UNIQUE INDEX ux_wm_active
  ON workspace_memberships(workspace_id, account_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_pal_person ON person_account_links(person_id);
CREATE INDEX IF NOT EXISTS idx_pal_account ON person_account_links(account_id);
CREATE INDEX IF NOT EXISTS idx_wm_account ON workspace_memberships(account_id);
CREATE INDEX IF NOT EXISTS idx_wm_workspace ON workspace_memberships(workspace_id);
```

### 5.3 Explicit non-FKs

- No `workspaces.id → organizations(id)`.
- No `user_accounts.id → users(id)`.

Same-ID mapping for migrated tenants is a later backfill invariant, not a
schema FK. Personal/casual workspaces have no organization counterpart.

## 6. Migration v3 — school roster

**Name:** `r1-school-roster`

**Version:** `3`

### 6.1 Tables

```sql
CREATE TABLE schools (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (id, workspace_id)
);

CREATE TABLE academic_years (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  school_id TEXT NOT NULL REFERENCES schools(id),
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned','active','closed')),
  CHECK (start_date <= end_date),
  UNIQUE (school_id, label)
);

CREATE TABLE grades (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  academic_year_id TEXT NOT NULL REFERENCES academic_years(id),
  code TEXT NOT NULL CHECK (length(trim(code)) > 0),
  display_label TEXT NOT NULL CHECK (length(trim(display_label)) > 0),
  sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
  UNIQUE (academic_year_id, code),
  UNIQUE (id, academic_year_id)
);

CREATE TABLE class_groups (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  academic_year_id TEXT NOT NULL REFERENCES academic_years(id),
  grade_id TEXT NOT NULL,
  label TEXT NOT NULL CHECK (length(trim(label)) > 0),
  UNIQUE (academic_year_id, grade_id, label),
  FOREIGN KEY (grade_id, academic_year_id)
    REFERENCES grades(id, academic_year_id)
);

CREATE TABLE enrollments (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  person_id TEXT NOT NULL REFERENCES people(id),
  class_group_id TEXT NOT NULL REFERENCES class_groups(id),
  status TEXT NOT NULL CHECK (status IN ('active','ended')),
  start_date TEXT NOT NULL,
  end_date TEXT,
  attendance_number TEXT,
  CHECK (end_date IS NULL OR start_date <= end_date),
  CHECK (
    (status = 'active' AND end_date IS NULL)
    OR (status = 'ended' AND end_date IS NOT NULL)
  ),
  CHECK (
    attendance_number IS NULL OR length(trim(attendance_number)) > 0
  )
);

CREATE TABLE staff_assignments (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  person_id TEXT NOT NULL REFERENCES people(id),
  class_group_id TEXT NOT NULL REFERENCES class_groups(id),
  role TEXT NOT NULL CHECK (role IN ('teacher','assistant')),
  status TEXT NOT NULL CHECK (status IN ('active','ended')),
  start_date TEXT NOT NULL,
  end_date TEXT,
  CHECK (end_date IS NULL OR start_date <= end_date),
  CHECK (
    (status = 'active' AND end_date IS NULL)
    OR (status = 'ended' AND end_date IS NOT NULL)
  )
);
```

### 6.2 Indexes

```sql
CREATE UNIQUE INDEX ux_enroll_active_attendance
  ON enrollments(class_group_id, attendance_number)
  WHERE status = 'active' AND attendance_number IS NOT NULL;

CREATE UNIQUE INDEX ux_enroll_active_person_class
  ON enrollments(person_id, class_group_id) WHERE status = 'active';

CREATE UNIQUE INDEX ux_staff_active_person_class_role
  ON staff_assignments(person_id, class_group_id, role)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_schools_workspace ON schools(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ay_school ON academic_years(school_id);
CREATE INDEX IF NOT EXISTS idx_grades_ay ON grades(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_cg_ay ON class_groups(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_cg_grade ON class_groups(grade_id);
CREATE INDEX IF NOT EXISTS idx_enroll_class ON enrollments(class_group_id);
CREATE INDEX IF NOT EXISTS idx_enroll_person ON enrollments(person_id);
CREATE INDEX IF NOT EXISTS idx_staff_class ON staff_assignments(class_group_id);
CREATE INDEX IF NOT EXISTS idx_staff_person ON staff_assignments(person_id);
```

### 6.3 Service-only invariants (not in this DDL)

- `schools.workspace_id` must reference a workspace with `kind = 'school'`.
- True date-range overlap among active enrollments beyond the active/`end_date
  IS NULL` model (domain already treats active rows as open-ended).
- Progression/transfer/graduation semantics that close old rows.

## 7. Migration v4 — access, import, audit

**Name:** `r1-access-import-audit`

**Version:** `4`

### 7.1 Role assignments

```sql
CREATE TABLE role_assignments (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  account_id TEXT NOT NULL REFERENCES user_accounts(id),
  scope_kind TEXT NOT NULL
    CHECK (scope_kind IN ('system','workspace','school','class','project')),
  workspace_id TEXT REFERENCES workspaces(id),
  school_id TEXT REFERENCES schools(id),
  class_group_id TEXT REFERENCES class_groups(id),
  project_id TEXT REFERENCES projects(id),
  role TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','ended')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  CHECK (
    (scope_kind = 'system'
      AND workspace_id IS NULL AND school_id IS NULL
      AND class_group_id IS NULL AND project_id IS NULL)
    OR (scope_kind = 'workspace'
      AND workspace_id IS NOT NULL AND school_id IS NULL
      AND class_group_id IS NULL AND project_id IS NULL)
    OR (scope_kind = 'school'
      AND school_id IS NOT NULL AND workspace_id IS NULL
      AND class_group_id IS NULL AND project_id IS NULL)
    OR (scope_kind = 'class'
      AND class_group_id IS NOT NULL AND workspace_id IS NULL
      AND school_id IS NULL AND project_id IS NULL)
    OR (scope_kind = 'project'
      AND project_id IS NOT NULL AND workspace_id IS NULL
      AND school_id IS NULL AND class_group_id IS NULL)
  ),
  CHECK (
    (scope_kind = 'system' AND role IN ('owner','operator'))
    OR (scope_kind = 'workspace'
      AND role IN ('owner','admin','member','guest'))
    OR (scope_kind = 'school'
      AND role IN ('school_admin','staff','student'))
    OR (scope_kind = 'class'
      AND role IN ('teacher','assistant','student'))
    OR (scope_kind = 'project'
      AND role IN ('owner','host','editor','commenter','viewer'))
  ),
  CHECK (
    (status = 'active' AND ended_at IS NULL)
    OR (status = 'ended' AND ended_at IS NOT NULL)
  )
);
```

`project_id → projects(id)` is an intentional child FK onto the frozen legacy
projects table. Because this slice creates no project rows and does not alter
legacy project rows, `PRAGMA foreign_key_check` remains empty. Later project
integration may add `projects.workspace_id`; that ALTER is out of scope here.

### 7.2 Roster imports

```sql
CREATE TABLE roster_imports (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  workspace_id TEXT NOT NULL,
  school_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'uploaded','validated','preview_ready','applied','failed','discarded'
  )),
  uploaded_at TEXT NOT NULL,
  preview_hash TEXT CHECK (
    preview_hash IS NULL
    OR (
      length(preview_hash) = 64
      AND preview_hash = lower(preview_hash)
      AND preview_hash NOT GLOB '*[^0-9a-f]*'
    )
  ),
  base_directory_revision INTEGER CHECK (
    base_directory_revision IS NULL OR base_directory_revision >= 0
  ),
  applied_at TEXT,
  CHECK (
    (status = 'applied' AND applied_at IS NOT NULL)
    OR (status <> 'applied' AND applied_at IS NULL)
  ),
  FOREIGN KEY (school_id, workspace_id)
    REFERENCES schools(id, workspace_id)
);

CREATE TABLE roster_import_rows (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  import_id TEXT NOT NULL REFERENCES roster_imports(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL CHECK (row_number >= 0),
  category TEXT NOT NULL CHECK (category IN (
    'add_person','update_display_fields','new_enrollment',
    'class_move','end_enrollment','duplicate_candidate',
    'attendance_collision','ambiguous_account_link','rejected_row'
  )),
  person_id TEXT REFERENCES people(id),
  proposed_json TEXT NOT NULL CHECK (
    json_valid(proposed_json) AND json_type(proposed_json) = 'object'
  ),
  issues_json TEXT NOT NULL CHECK (
    json_valid(issues_json) AND json_type(issues_json) = 'array'
  ),
  UNIQUE (import_id, row_number)
);
```

### 7.3 Audit events

```sql
CREATE TABLE audit_events (
  id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
  workspace_id TEXT REFERENCES workspaces(id),
  actor_account_id TEXT REFERENCES user_accounts(id),
  action TEXT NOT NULL CHECK (length(trim(action)) > 0),
  subject_type TEXT NOT NULL CHECK (length(trim(subject_type)) > 0),
  subject_id TEXT NOT NULL CHECK (length(trim(subject_id)) > 0),
  payload_json TEXT NOT NULL CHECK (
    json_valid(payload_json) AND json_type(payload_json) = 'object'
  ),
  created_at TEXT NOT NULL,
  directory_revision INTEGER NOT NULL CHECK (directory_revision >= 0)
);

CREATE TRIGGER audit_events_no_update
BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events are append-only');
END;

CREATE TRIGGER audit_events_no_delete
BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events are append-only');
END;
```

### 7.4 Indexes

```sql
CREATE UNIQUE INDEX ux_ra_active_unique
  ON role_assignments(
    account_id,
    scope_kind,
    COALESCE(workspace_id, ''),
    COALESCE(school_id, ''),
    COALESCE(class_group_id, ''),
    COALESCE(project_id, ''),
    role
  )
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_ra_account_status
  ON role_assignments(account_id, status);
CREATE INDEX IF NOT EXISTS idx_ra_ws_role
  ON role_assignments(workspace_id, role) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_ra_sys_role
  ON role_assignments(scope_kind, role) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_ri_workspace ON roster_imports(workspace_id);
CREATE INDEX IF NOT EXISTS idx_ri_school ON roster_imports(school_id);
CREATE INDEX IF NOT EXISTS idx_rir_import ON roster_import_rows(import_id);
CREATE INDEX IF NOT EXISTS idx_audit_ws_time
  ON audit_events(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_audit_subject
  ON audit_events(subject_type, subject_id);
```

### 7.5 Service-only invariants deferred

- Last System Owner / Workspace Owner protection
- Stale preview / stale directory revision apply conflicts
- Capability evaluation (already pure in `@blocksync/workspace-directory`)
- Mutation + audit event atomicity

## 8. Descriptor and checksum conventions

Each new migration exports:

```ts
export const r1IdentityCoreChecksumSource = [
  "version=2",
  "name=r1-identity-core",
  // one stable label per CREATE TABLE / UNIQUE INDEX / TRIGGER block
].join("\n");
```

Labels are stable identifiers for checksum identity, not DDL text hashes. DDL
drift is caught by:

1. focused DDL/fingerprint contract tests for each migration;
2. the committed final `r1-target-schema-fingerprint.json`.

Production registry becomes:

```ts
const migrations = [
  r1BaselineMigration,
  r1IdentityCoreMigration,
  r1SchoolRosterMigration,
  r1AccessImportAuditMigration,
] as const;
```

## 9. Testing requirements

### 9.1 Per-migration unit tests

For each of v2/v3/v4:

1. descriptor `version` / `name` / checksum recomputation;
2. apply on configured `:memory:` DB creates expected tables/indexes/triggers;
3. invalid enum / history consistency / empty ID rejected by SQLite;
4. partial unique and composite FK cases reject bad inserts;
5. `PRAGMA foreign_key_check` empty after apply.

### 9.2 Final fingerprint

- Generator opens a temporary DB, runs production registry to v4, captures
  fingerprint with the existing `captureSchemaFingerprint` helper, writes
  `r1-target-schema-fingerprint.json`.
- Maintenance script never opens the committed legacy fixture source.
- Tests assert fresh apply-to-v4 matches the committed target fingerprint.

### 9.3 Production integration / evidence

Using the production registry:

1. Fresh DB → ledger versions `[1,2,3,4]`, `user_version = 4`, FK check empty,
   all new tables present and empty.
2. Copied `legacy-r1` fixture → same ledger/`user_version`, new tables empty,
   frozen logical manifest evidence and snapshot blob SHA unchanged
   (`databaseSha256` may change).
3. Fault injection on v3 and v4 (`after_apply_before_ledger`,
   `after_ledger_before_user_version`) rolls back only the current version;
   reopen/retry reaches the same end state as one-pass apply.
4. Two-process race on empty temp DB yields exactly one row per version 1–4.
5. `audit_events` UPDATE/DELETE abort.
6. Static boundary: non-test production sources outside migrations do not
   reference new table names.

### 9.4 Existing tests to update vs keep

Must update (production registry consumers expecting v1-only end state):

- `workspace-migration-fixture.test.ts`
- production-registry cases in `adoption.test.ts`
- `concurrency.test.ts`

Must keep as v1-only / baseline-only:

- `0001-r1-baseline.test.ts`
- runner unit tests that pass `[r1BaselineMigration]` explicitly
- `legacy-r1-fixture.test.ts` (`user_version = 0`, no ledger)
- `r1-baseline-fingerprints.json` contents

## 10. Acceptance criteria

- Registry is `[1,2,3,4]` with immutable checksums and names.
- Fresh and adopted-legacy databases reach version 4 with empty target tables.
- Frozen revision/snapshot/auth evidence remains byte-stable except DB file SHA.
- CHECK / partial UNIQUE / composite FK / JSON / append-only audit contracts
  reject invalid writes.
- Baseline adoption fingerprints unchanged.
- No production repository/service reads or writes the new tables.
- Required gates remain green:
  - `pnpm --filter @blocksync/project-store-sqlite test`
  - `pnpm --filter @blocksync/project-store-sqlite typecheck`
  - `pnpm --filter @blocksync/session-service test`
  - `pnpm --filter @blocksync/workspace-directory test`
  - `git diff --check`

## 11. Stop conditions

- Any legacy row mutation or V1 envelope rewrite/rehash.
- FK from `workspaces`/`user_accounts` to `organizations`/`users`.
- `ALTER` of populated legacy tables in this slice.
- Regenerating baseline adoption fingerprints to include v2–v4 tables.
- Implementing Person ID derivation, backfill, claim/setup-secret/rate-limit.
- Production cutover that reads empty target tables for authorization.
- Down migrations or second SQLite connections inside migration callbacks.

## 12. Resolved decisions

1. Full additive schema now; legacy backfill is a later slice.
2. Version split: v2 identity / v3 school roster / v4 access·import·audit.
3. Claim / setup-secret / rate-limit deferred to v5+ after Phase 4 contracts.
4. Active attendance numbers use a partial UNIQUE index; services still enforce
   overlap semantics.
5. Project-scoped role assignments FK to legacy `projects(id)`.
6. No FK to `organizations` or `users`.
7. Final v4 schema fingerprint is committed as a separate JSON artifact.
8. Audit append-only is enforced with BEFORE UPDATE/DELETE triggers.
9. Cross-table rules (school kind, last owner, stale preview) remain service
   invariants.

## 13. Follow-on slices

1. TDD implementation of this design (detailed plan after written-spec GO).
2. Legacy organization/user/membership/project/session backfill with backup
   gate and deterministic Person IDs.
3. Repository ports/adapters and directory services.
4. Auth cutover + claim/setup-secret/rate-limit migrations (v5+).
5. Management APIs and UI per the parent roadmap.
