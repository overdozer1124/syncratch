# R1 Legacy Organization/User Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an immutable version 5 migration that takes a verified pre-migration backup, deterministically backfills accepted legacy organizations/users/access into the Workspace/Person schema, revokes legacy sessions, and preserves V1 evidence.

**Architecture:** Extend the synchronous migration runner with an optional preparation phase outside the version transaction, then revalidate under `BEGIN IMMEDIATE` before applying DML. Version 5 uses a verified `VACUUM INTO` snapshot, fixed UUIDv5 identities, a full-column legacy digest, a read-only validation/mapping pass, and one atomic backfill transaction.

**Tech Stack:** TypeScript, pnpm, Vitest, better-sqlite3, Node `crypto`/`fs`/`path`, existing migration runner/fingerprint/fixture helpers.

## Global Constraints

- Versions 1-4, their descriptors, checksums, DDL, and
  `r1-target-schema-fingerprint.json` are immutable.
- The only legacy column version 5 may update is `sessions.revoked_at`.
- Do not rewrite projects, V1 envelope JSON, revisions, snapshots, assets,
  hashes, actor IDs, timestamps, or client transaction IDs.
- Do not create school, roster, import, audit, claim, setup-secret, rate-limit,
  repository, API, UI, or auth-principal cutover behavior.
- Do not add `projects.workspace_id`, alter populated legacy tables, or delete
  legacy tables.
- Copy `legacy-r1.sqlite` before every test; never open the committed source.
- `organizations.id` maps to the same Workspace ID with `kind='casual'`.
- `users.id` maps to the same UserAccount ID. Never merge People by email or
  external identity.
- All synthesized domain IDs use UUIDv5 namespace
  `5382ca4a-3efd-5013-bbff-25dc72876ebf` and the exact UTF-8 names in the
  approved design.
- Organization roles map only `admin->admin`, `member->member`. Project roles
  must already be one of `owner|host|editor|commenter|viewer`.
- Suspended organizations and disabled users receive ended memberships and
  assignments; no Workspace Owner is synthesized.
- All unrevoked legacy sessions are revoked with the runner's single
  `appliedAt`.
- A non-empty legacy database must pass the `VACUUM INTO` backup gate before
  version 5 DML.
- Preparation is synchronous and outside a transaction; version 5 DML,
  session revocation, FK check, ledger insert, and `user_version=5` are one
  `BEGIN IMMEDIATE` transaction.
- Do not touch or stage `docs/ai-platform/`.

---

## File Map

| Path | Responsibility |
|---|---|
| `packages/project-store-sqlite/src/migrations/types.ts` | Migration context, preparation contract, new error codes |
| `packages/project-store-sqlite/src/migrations/runner.ts` | Two-phase prepared-migration lifecycle |
| `packages/project-store-sqlite/src/migrations/runner-prepared.test.ts` | Preparation ordering, context, and race contracts |
| `packages/project-store-sqlite/src/migrations/backfill/identity.ts` | UUIDv5 IDs, canonical UTC helpers, display fallback |
| `packages/project-store-sqlite/src/migrations/backfill/identity.test.ts` | Golden vectors and pure mapping helpers |
| `packages/project-store-sqlite/src/migrations/backfill/legacy-digest.ts` | Full-column canonical legacy SHA-256 |
| `packages/project-store-sqlite/src/migrations/backfill/legacy-digest.test.ts` | Digest completeness, typing, and sensitivity |
| `packages/project-store-sqlite/src/migrations/backfill/source.ts` | Typed legacy/target readers |
| `packages/project-store-sqlite/src/migrations/backfill/validate.ts` | Fail-closed source and target validation |
| `packages/project-store-sqlite/src/migrations/backfill/plan.ts` | Pure deterministic target-row plan |
| `packages/project-store-sqlite/src/migrations/backfill/plan.test.ts` | Mapping and invalid-source matrix |
| `packages/project-store-sqlite/src/migrations/backfill/backup.ts` | VACUUM, verification, superseded-race handling |
| `packages/project-store-sqlite/src/migrations/backfill/backup.test.ts` | Backup trigger/failure/race matrix |
| `packages/project-store-sqlite/src/migrations/0005-r1-legacy-organization-user-backfill.ts` | Immutable v5 descriptor and atomic DML |
| `packages/project-store-sqlite/src/migrations/0005-r1-legacy-organization-user-backfill.test.ts` | Descriptor, DML, rollback/retry |
| `packages/project-store-sqlite/src/migrations/legacy-backfill-integration.test.ts` | Fresh/copied evidence and production-boundary proof |
| `packages/project-store-sqlite/src/migrations/index.ts` | Production registry `[1..5]` |
| Existing production-registry tests | Update end-state expectations from v4 to v5 |
| `docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md` | Mark Phase 2 Task 3 complete after gates |

---

### Task 1: Add the prepared-migration runner lifecycle

**Files:**
- Modify: `packages/project-store-sqlite/src/migrations/types.ts`
- Modify: `packages/project-store-sqlite/src/migrations/runner.ts`
- Create: `packages/project-store-sqlite/src/migrations/runner-prepared.test.ts`

**Interfaces:**

```ts
export interface MigrationContext {
  appliedAt: string;
}

export interface SchemaMigration {
  readonly version: number;
  readonly name: string;
  readonly checksumSource: string;
  readonly checksum: string;
  prepare?(db: Database.Database, context: MigrationContext): unknown;
  apply(
    db: Database.Database,
    context?: MigrationContext,
    preparation?: unknown,
  ): void;
}
```

Existing `apply(db)` methods remain valid TypeScript implementations and are
not edited.

- [ ] **Step 1: Write failing prepared-runner tests**

Create `runner-prepared.test.ts` with file-backed temporary databases and
fixed `now: () => "2026-07-18T00:00:00.000Z"`.

Prove:

```ts
expect(db.inTransaction).toBe(false); // inside prepare
expect(context.appliedAt).toBe("2026-07-18T00:00:00.000Z");
expect(receivedPreparation).toEqual({token: "verified"});
```

Also prove:

- unprepared migrations still call `apply` once inside a transaction;
- prepared migrations perform first ledger validation, prepare outside a
  transaction, then apply inside the second transaction;
- the same `MigrationContext` reaches `prepare`, `apply`, and ledger
  `applied_at`;
- if a second file connection records the exact migration during `prepare`,
  the outer runner rechecks the ledger and skips `apply`;
- preparation errors leave ledger and `user_version` unchanged;
- existing baseline adoption and both fault points keep their old behavior.

- [ ] **Step 2: Run RED**

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/runner-prepared.test.ts
```

Expected: FAIL because `MigrationContext` and `prepare` do not exist.

- [ ] **Step 3: Implement the minimal two-phase path**

In `types.ts`, add `MigrationContext` and the method signatures above. Add:

```ts
| "SCHEMA_BACKUP_FAILED"
| "SCHEMA_BACKFILL_INVALID"
```

to `SchemaMigrationErrorCode`.

In `runner.ts`:

```ts
const context: MigrationContext = {appliedAt: now()};
```

For descriptors without `prepare`, preserve the existing single transaction
and call `apply(db, context)`. Existing implementations ignore the extra
argument.
For descriptors with `prepare`:

1. validate pending/next under `withMigrationTransaction`;
2. commit;
3. call `migration.prepare(db, context)`;
4. reacquire `withMigrationTransaction`;
5. revalidate; skip when already applied;
6. call `migration.apply(db, context, preparation)` and use the existing
   fault/FK/ledger/version sequence.

Do not run preparation during ledgerless baseline adoption.

- [ ] **Step 4: GREEN and regression**

```text
pnpm --filter @blocksync/project-store-sqlite test -- \
  src/migrations/runner-prepared.test.ts \
  src/migrations/runner.test.ts \
  src/migrations/adoption.test.ts
pnpm --filter @blocksync/project-store-sqlite typecheck
```

Expected: all pass; existing v1-v4 tests require no descriptor edits.

- [ ] **Step 5: Commit**

```bash
git add packages/project-store-sqlite/src/migrations/types.ts \
  packages/project-store-sqlite/src/migrations/runner.ts \
  packages/project-store-sqlite/src/migrations/runner-prepared.test.ts
git commit -m "feat(store): add prepared migration lifecycle"
```

---

### Task 2: Freeze deterministic legacy identities and timestamps

**Files:**
- Create: `packages/project-store-sqlite/src/migrations/backfill/identity.ts`
- Create: `packages/project-store-sqlite/src/migrations/backfill/identity.test.ts`

**Interfaces:**

```ts
export const R1_LEGACY_BACKFILL_NAMESPACE =
  "5382ca4a-3efd-5013-bbff-25dc72876ebf";

export function uuidv5(namespace: string, name: string): string;
export function legacyPersonId(userId: string): string;
export function legacyPersonAccountLinkId(userId: string): string;
export function legacyWorkspaceMembershipId(
  organizationId: string,
  userId: string,
): string;
export function legacyWorkspaceRoleAssignmentId(
  organizationId: string,
  userId: string,
  role: "admin" | "member",
): string;
export function legacyProjectRoleAssignmentId(
  projectId: string,
  userId: string,
  role: "owner" | "host" | "editor" | "commenter" | "viewer",
): string;
export function legacyPersonDisplayName(
  displayName: string | null,
  email: string | null,
): string;
export function assertCanonicalUtc(value: string, field: string): void;
export function laterCanonicalUtc(left: string, right: string): string;
```

- [ ] **Step 1: Write golden-vector tests first**

The tests must freeze:

```ts
expect(
  uuidv5(
    "6ba7b811-9dad-11d1-80b4-00c04fd430c8",
    "https://blocksync.dev/namespaces/r1-legacy-backfill",
  ),
).toBe("5382ca4a-3efd-5013-bbff-25dc72876ebf");

expect(legacyPersonId("user-1")).toBe(
  "0caeccdd-8df5-5682-9112-2f77411c7e69",
);

expect(legacyPersonAccountLinkId("user-1")).toBe(
  "f917e21d-b361-56b2-8cf2-ae463d03d54c",
);
expect(legacyWorkspaceMembershipId("org-1", "user-1")).toBe(
  "5f6fa498-0668-583f-8927-fdc3b3222d47",
);
expect(
  legacyWorkspaceRoleAssignmentId("org-1", "user-1", "admin"),
).toBe("cac163a5-1cba-56d0-babe-289576604073");

expect(
  legacyProjectRoleAssignmentId("project-1", "user-1", "owner"),
).toBe("0bfb42a1-6055-51ef-85c0-a08764889681");
expect(
  legacyProjectRoleAssignmentId("project-1", "user-1", "host"),
).toBe("ebe958b9-889d-58cf-b6ff-ae77837c4883");
expect(
  legacyProjectRoleAssignmentId("project-1", "user-1", "editor"),
).toBe("a4bb6f11-6eb5-501c-8513-a4666e3f8e75");
expect(
  legacyProjectRoleAssignmentId("project-1", "user-1", "commenter"),
).toBe("2339f2cd-7f67-5aab-b188-b0a271ae8bec");
expect(
  legacyProjectRoleAssignmentId("project-1", "user-1", "viewer"),
).toBe("3d7e03a7-dc31-5c71-b590-0eeeb1cdff3a");
```

Test:

- UTF-8 input is byte-preserving and case-sensitive;
- UUID version nibble is `5` and RFC variant is correct;
- fallback order is trimmed display name, trimmed email, `Legacy user`;
- canonical UTC accepts only `YYYY-MM-DDTHH:MM:SS.sssZ`;
- `laterCanonicalUtc` returns the chronologically later canonical value.

- [ ] **Step 2: Run RED**

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/backfill/identity.test.ts
```

Expected: FAIL because `identity.ts` does not exist.

- [ ] **Step 3: Implement UUIDv5 and pure helpers**

Use Node `createHash("sha1")`, parse the namespace's 16 bytes, hash namespace
bytes followed by UTF-8 name bytes, then set:

```ts
bytes[6] = (bytes[6]! & 0x0f) | 0x50;
bytes[8] = (bytes[8]! & 0x3f) | 0x80;
```

Format lowercase hexadecimal `8-4-4-4-12`. Do not add a UUID dependency.
Name builders must concatenate the exact prefixes from the approved design.

- [ ] **Step 4: GREEN and typecheck**

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/backfill/identity.test.ts
pnpm --filter @blocksync/project-store-sqlite typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/project-store-sqlite/src/migrations/backfill/identity.ts \
  packages/project-store-sqlite/src/migrations/backfill/identity.test.ts
git commit -m "feat(store): add deterministic legacy backfill identity"
```

---

### Task 3: Capture a full-column canonical legacy digest

**Files:**
- Create: `packages/project-store-sqlite/src/migrations/backfill/legacy-digest.ts`
- Create: `packages/project-store-sqlite/src/migrations/backfill/legacy-digest.test.ts`

**Interfaces:**

```ts
export interface LegacyDigestTable {
  readonly name: string;
  readonly columns: readonly string[];
  readonly orderBy: readonly string[];
}

export const LEGACY_DIGEST_TABLES: readonly LegacyDigestTable[];
export function captureLegacyDataDigest(db: Database.Database): string;
```

Freeze these 17 tables and all listed columns:

1. `organizations`
2. `organization_domains`
3. `users`
4. `organization_memberships`
5. `external_identities`
6. `sessions`
7. `projects`
8. `project_members`
9. `project_revisions`
10. `project_snapshots`
11. `asset_objects`
12. `organization_asset_grants`
13. `asset_import_leases`
14. `global_disk_reservations`
15. `organization_asset_quota_reservations`
16. `organization_asset_quota_reservation_shas`
17. `asset_gc_lock`

Freeze the exact column/order contract:

```ts
[
  ["organizations",
    ["id","name","status","created_at"], ["id"]],
  ["organization_domains",
    ["organization_id","hosted_domain"],
    ["organization_id","hosted_domain"]],
  ["users",
    ["id","primary_organization_id","display_name","email","status",
     "created_at","updated_at"], ["id"]],
  ["organization_memberships",
    ["organization_id","user_id","role"], ["organization_id","user_id"]],
  ["external_identities",
    ["provider","subject","user_id","organization_id","created_at"],
    ["provider","subject"]],
  ["sessions",
    ["id_hash","user_id","organization_id","csrf_hash","created_at",
     "expires_at","revoked_at","last_seen_at"], ["id_hash"]],
  ["projects",
    ["id","organization_id","owner_user_id","title","head_revision",
     "created_at","updated_at"], ["id"]],
  ["project_members",
    ["project_id","user_id","role"], ["project_id","user_id"]],
  ["project_revisions",
    ["project_id","revision","envelope_json","content_hash","request_hash",
     "actor_user_id","created_at","client_transaction_id"],
    ["project_id","revision"]],
  ["project_snapshots",
    ["id","project_id","based_on_revision","reason","content_hash",
     "storage_key","created_by","created_at"], ["project_id","id"]],
  ["asset_objects",
    ["sha256","byte_length","md5_hex","data_format","gc_state",
     "quarantine_started_at","created_at"], ["sha256"]],
  ["organization_asset_grants",
    ["organization_id","sha256","granted_at"], ["organization_id","sha256"]],
  ["asset_import_leases",
    ["lease_id","organization_id","sha256","import_session_id","created_at",
     "expires_at"], ["lease_id"]],
  ["global_disk_reservations",
    ["reservation_id","import_session_id","reserved_bytes",
     "materialized_bytes","expires_at","created_at"], ["reservation_id"]],
  ["organization_asset_quota_reservations",
    ["reservation_id","organization_id","import_session_id","reserved_bytes",
     "expires_at","created_at"], ["reservation_id"]],
  ["organization_asset_quota_reservation_shas",
    ["reservation_id","sha256","byte_length"], ["reservation_id","sha256"]],
  ["asset_gc_lock",
    ["id","owner","generation","acquired_at","expires_at"], ["id"]],
] as const;
```

- [ ] **Step 1: Write digest tests**

Build two independently seeded databases and assert equal digests. Then mutate
one cell at a time and assert inequality, including:

```ts
expect(digestWithNull).not.toBe(digestWithEmptyString);
expect(digestWithIntegerZero).not.toBe(digestWithTextZero);
expect(digestBeforeCsrfChange).not.toBe(digestAfterCsrfChange);
```

Assert the frozen table list and column arrays exactly, so adding or dropping
a legacy column requires an explicit review.

- [ ] **Step 2: Run RED**

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/backfill/legacy-digest.test.ts
```

- [ ] **Step 3: Implement stable capture**

For each frozen table:

- issue an explicit `SELECT column1,... ORDER BY key1,...`;
- encode rows as arrays, not objects;
- encode each SQLite value as `[typeof-tag, value]`, preserving `NULL`,
  integer, real, text, and blob;
- serialize `{format:"blocksync.r1-legacy-digest/v1",tables:[...]}`;
- return lowercase SHA-256 of the UTF-8 JSON.

Fail closed if a frozen table or column is missing. Exclude target tables,
`schema_migrations`, page layout, and file hashes.

- [ ] **Step 4: GREEN and typecheck**

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/backfill/legacy-digest.test.ts
pnpm --filter @blocksync/project-store-sqlite typecheck
```

- [ ] **Step 5: Commit**

```bash
git add packages/project-store-sqlite/src/migrations/backfill/legacy-digest.ts \
  packages/project-store-sqlite/src/migrations/backfill/legacy-digest.test.ts
git commit -m "feat(store): add canonical legacy data digest"
```

---

### Task 4: Validate legacy input and compute the backfill plan

**Files:**
- Create: `packages/project-store-sqlite/src/migrations/backfill/source.ts`
- Create: `packages/project-store-sqlite/src/migrations/backfill/validate.ts`
- Create: `packages/project-store-sqlite/src/migrations/backfill/plan.ts`
- Create: `packages/project-store-sqlite/src/migrations/backfill/plan.test.ts`

**Interfaces:**

```ts
export interface LegacyBackfillSource {
  organizations: readonly LegacyOrganizationRow[];
  users: readonly LegacyUserRow[];
  memberships: readonly LegacyMembershipRow[];
  sessions: readonly LegacySessionRow[];
  projects: readonly LegacyProjectRow[];
  projectMembers: readonly LegacyProjectMemberRow[];
  targetRowCounts: Readonly<Record<
    | "workspaces"
    | "user_accounts"
    | "people"
    | "person_account_links"
    | "workspace_memberships"
    | "workspace_directory_revisions"
    | "role_assignments",
    number
  >>;
}

export function readLegacyBackfillSource(
  db: Database.Database,
): LegacyBackfillSource;
export function validateLegacyBackfillSource(
  source: LegacyBackfillSource,
): void;
export function computeLegacyBackfillPlan(
  source: LegacyBackfillSource,
  context: MigrationContext,
): LegacyBackfillPlan;
```

`LegacyBackfillPlan` contains readonly arrays for all seven target tables plus
`sessionIdsToRevoke`.

- [ ] **Step 1: Write the invalid-source matrix**

Create table-driven tests that expect
`SchemaMigrationError.code === "SCHEMA_BACKFILL_INVALID"` for:

- blank source ID or organization name;
- non-canonical source timestamps;
- organization status outside `active|suspended`;
- user status outside `active|disabled`;
- missing primary organization or primary membership;
- missing membership organization/user;
- missing project organization/owner;
- owner/member without membership in the project's organization;
- project role outside `owner|host|editor|commenter|viewer`;
- inconsistent session organization membership;
- any existing row in a target table.

- [ ] **Step 2: Write expected plan tests**

With fixed context:

```ts
const context = {appliedAt: "2026-07-18T00:00:00.000Z"};
```

Assert exact rows for:

- same-ID casual Workspace and revision `0`;
- same-ID account and deterministic Person/link;
- display fallback;
- active admin/member membership plus matching workspace assignment;
- suspended organization and disabled user produce `ended` rows;
- project owner normalization creates exactly one owner assignment;
- non-owner exact project roles remain unchanged;
- pre-revoked sessions are absent from `sessionIdsToRevoke`;
- unrevoked sessions are present.

- [ ] **Step 3: Run RED**

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/backfill/plan.test.ts
```

- [ ] **Step 4: Implement readers, validation, and pure plan**

Read source rows with explicit columns and deterministic ordering. Run all
validation before constructing target rows.

For membership/project `started_at`, use `laterCanonicalUtc`. Normalize an
owner's duplicate `project_members` row before deterministic target-conflict
checks. Never silently drop an invalid row.

- [ ] **Step 5: GREEN and typecheck**

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/backfill/plan.test.ts
pnpm --filter @blocksync/project-store-sqlite typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/project-store-sqlite/src/migrations/backfill/source.ts \
  packages/project-store-sqlite/src/migrations/backfill/validate.ts \
  packages/project-store-sqlite/src/migrations/backfill/plan.ts \
  packages/project-store-sqlite/src/migrations/backfill/plan.test.ts
git commit -m "feat(store): validate and plan legacy backfill"
```

---

### Task 5: Implement the verified pre-v5 backup gate

**Files:**
- Create: `packages/project-store-sqlite/src/migrations/backfill/backup.ts`
- Create: `packages/project-store-sqlite/src/migrations/backfill/backup.test.ts`

**Interfaces:**

```ts
export type LegacyBackfillPreparation =
  | {kind: "empty"}
  | {kind: "verified"; backupPath: string; legacyDigest: string}
  | {kind: "already_applied"; backupPath: string};

export function prepareLegacyBackfillBackup(
  db: Database.Database,
  context: MigrationContext,
): LegacyBackfillPreparation;
```

- [ ] **Step 1: Write trigger and successful-backup tests**

Prove:

- `db.memory === true` with no legacy rows returns `{kind:"empty"}`;
- an in-memory database with legacy rows throws `SCHEMA_BACKUP_FAILED`;
- file DB with all six trigger tables empty creates no backup;
- copied legacy fixture, advanced explicitly through v4, creates one adjacent
  file matching:

```regex
\.pre-v5\.20260718T000000000Z\.[0-9a-f]{16}\.sqlite$
```

- the backup has integrity `ok`, no FK violations, `user_version=4`, committed
  v4 fingerprint equality, and the same legacy digest;
- the destination is never overwritten.

- [ ] **Step 2: Write failure and race tests**

Inject seams for destination generation and post-vacuum verification. Prove:

- collision, VACUUM failure, integrity/FK/version/fingerprint/digest mismatch
  throw `SCHEMA_BACKUP_FAILED`;
- when the backup reports version 5 and the live ledger contains the exact v5
  name/checksum, rename once to `.superseded-v5.sqlite` and return
  `{kind:"already_applied"}`;
- version 5 with a missing/mismatched ledger remains a failure;
- two preparations use distinct suffixes.

- [ ] **Step 3: Run RED**

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/backfill/backup.test.ts
```

- [ ] **Step 4: Implement VACUUM and verification**

Use `db.memory`/`db.name` for file detection. Quote the `VACUUM INTO` string
literal safely by replacing `'` with `''`; do not interpolate unescaped paths.

Open the artifact with:

```ts
new Database(backupPath, {readonly: true, fileMustExist: true});
```

Configure foreign keys before checks. Always close the readonly connection in
`finally`. Never delete a failed backup.

Use `randomBytes(8).toString("hex")` only for the operational filename suffix;
domain IDs remain deterministic.

- [ ] **Step 5: GREEN and typecheck**

```text
pnpm --filter @blocksync/project-store-sqlite test -- src/migrations/backfill/backup.test.ts
pnpm --filter @blocksync/project-store-sqlite typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/project-store-sqlite/src/migrations/backfill/backup.ts \
  packages/project-store-sqlite/src/migrations/backfill/backup.test.ts
git commit -m "feat(store): add verified pre-v5 backup gate"
```

---

### Task 6: Add immutable version 5 backfill DML

**Files:**
- Create: `packages/project-store-sqlite/src/migrations/0005-r1-legacy-organization-user-backfill.ts`
- Create: `packages/project-store-sqlite/src/migrations/0005-r1-legacy-organization-user-backfill.test.ts`

**Interfaces:**

```ts
export const r1LegacyOrganizationUserBackfillChecksumSource: string;
export const r1LegacyOrganizationUserBackfillMigration: SchemaMigration;
```

Use this checksum source exactly:

```ts
export const r1LegacyOrganizationUserBackfillChecksumSource = [
  "version=5",
  "name=r1-legacy-organization-user-backfill",
  "prepare:verified-vacuum-backup-v1",
  "validate:legacy-backfill-source-v1",
  "identity:uuidv5-5382ca4a-3efd-5013-bbff-25dc72876ebf",
  "insert:workspaces,user_accounts,people,person_account_links",
  "insert:workspace_memberships,workspace_directory_revisions,role_assignments",
  "update:sessions-revoke-unrevoked",
  "guard:locked-legacy-digest",
].join("\n");
```

Hard-code this computed lowercase SHA-256 in the descriptor:

```text
c88745d2f32c1f59426bc83a58254e8ce77dd876e93fda075449d6f297cd2e08
```

- [ ] **Step 1: Write descriptor and direct migration tests**

Apply explicit migrations `[v1,v2,v3,v4,v5]` to copied fixture databases.
Assert:

- immutable version/name/checksum;
- preparation creates a verified backup;
- `apply` first compares `preparation.legacyDigest` with the live digest;
- `empty` preparation performs no target DML;
- `already_applied` while v5 is still pending throws
  `SCHEMA_BACKFILL_INVALID`;
- every planned target row is inserted exactly;
- only null session revocations become `context.appliedAt`;
- `PRAGMA foreign_key_check` is empty.

- [ ] **Step 2: Write locked-digest and rollback/retry tests**

Mutate a legacy row after preparation but before the second transaction and
expect `SCHEMA_BACKFILL_INVALID` with zero target rows and `user_version=4`.

For each existing fault point:

```ts
"after_apply_before_ledger"
"after_ledger_before_user_version"
```

assert rollback of target rows and session revocation, no v5 ledger row,
`user_version=4`, backup retained, and retry success. With the same fixed
clock, compare all target rows against a one-shot migration.

- [ ] **Step 3: Run RED**

```text
pnpm --filter @blocksync/project-store-sqlite test -- \
  src/migrations/0005-r1-legacy-organization-user-backfill.test.ts
```

- [ ] **Step 4: Implement preparation, DML, and checksum**

`prepare` delegates to `prepareLegacyBackfillBackup`.

`apply`:

1. validates the preparation discriminant;
2. returns only for `{kind:"empty"}` after proving source is empty;
3. recomputes live digest under the runner's write lock;
4. reads and validates source;
5. computes the full plan;
6. inserts target rows in FK order using prepared statements;
7. updates sessions by explicit ID with `WHERE revoked_at IS NULL`;
8. asserts the update count equals `sessionIdsToRevoke.length`.

Do not start a nested transaction or open a second connection in `apply`.

- [ ] **Step 5: GREEN and typecheck**

```text
pnpm --filter @blocksync/project-store-sqlite test -- \
  src/migrations/0005-r1-legacy-organization-user-backfill.test.ts
pnpm --filter @blocksync/project-store-sqlite typecheck
```

- [ ] **Step 6: Commit**

```bash
git add packages/project-store-sqlite/src/migrations/0005-r1-legacy-organization-user-backfill.ts \
  packages/project-store-sqlite/src/migrations/0005-r1-legacy-organization-user-backfill.test.ts
git commit -m "feat(store): migrate legacy organizations without rehash"
```

---

### Task 7: Wire production registry and prove integration/race gates

**Files:**
- Modify: `packages/project-store-sqlite/src/migrations/index.ts`
- Create: `packages/project-store-sqlite/src/migrations/legacy-backfill-integration.test.ts`
- Modify: `packages/project-store-sqlite/src/migrations/target-schema.test.ts`
- Modify: `packages/project-store-sqlite/src/migrations/adoption.test.ts`
- Modify: `packages/project-store-sqlite/src/migrations/concurrency.test.ts`
- Modify: `packages/project-store-sqlite/src/workspace-migration-fixture.test.ts`
- Modify: `docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md`

**Production registry:**

```ts
const migrations = [
  r1BaselineMigration,
  r1IdentityCoreMigration,
  r1SchoolRosterMigration,
  r1AccessImportAuditMigration,
  r1LegacyOrganizationUserBackfillMigration,
] as const;
```

- [ ] **Step 1: Write/update failing production-path tests**

In `legacy-backfill-integration.test.ts`, prove:

1. fresh file DB reaches ledger `[1,2,3,4,5]`, `user_version=5`, creates no
   backup, has no target rows, and retains the v4 schema fingerprint;
2. `copyLegacyR1Fixture` plus `openSqliteStore` creates a verified backup and
   expected deterministic rows;
3. pre/post `readLegacyR1Manifest` differs only in null session `revokedAt` and
   `databaseSha256`;
4. envelope JSON, revision hashes, snapshot metadata/blob SHA, asset evidence,
   actor IDs, timestamps, and client transaction IDs are unchanged;
5. production non-migration sources still do not read/write target table names.

Update production registry consumers:

- version/ledger expectations `4`/`[1..4]` become `5`/`[1..5]`;
- copied-fixture tests expect the seven backfilled identity/access tables to
  contain their exact mapped rows;
- split the old all-target-tables-empty helper: `schools`, academic/roster,
  import, and `audit_events` stay empty, while `workspaces`, `user_accounts`,
  `people`, `person_account_links`, `workspace_memberships`,
  `workspace_directory_revisions`, and `role_assignments` are populated;
- explicit `[r1BaselineMigration]`, direct v1-v4 fingerprint tests, and
  ledgerless fixture tests retain their old semantics.

Run RED before editing `index.ts`.

- [ ] **Step 2: Run RED**

```text
pnpm --filter @blocksync/project-store-sqlite test -- \
  src/migrations/legacy-backfill-integration.test.ts \
  src/migrations/target-schema.test.ts \
  src/migrations/adoption.test.ts \
  src/migrations/concurrency.test.ts \
  src/workspace-migration-fixture.test.ts
```

Expected: FAIL on missing v5 registration and v4-only end-state assertions.

- [ ] **Step 3: Wire the registry and update only production consumers**

Append v5 in `index.ts`. Do not change
`r1-target-schema-fingerprint.json` or its generator.
Keep both fresh and copied end-state assertions that
`captureSchemaFingerprint(db) === targetFingerprint.current`; v5 changes rows,
not schema.

Extend `concurrency.test.ts` with a copied-legacy two-process case using the
existing `migration-race-child.ts`. Assert:

- both child processes exit successfully;
- one exact v5 ledger row;
- no duplicate target IDs;
- sessions revoked once;
- backup basenames are unique;
- FK check empty and schema fingerprint unchanged.

Update roadmap Phase 2 Task 3 checkboxes only after these tests pass. Keep
repository/API/claim tasks unchecked.

- [ ] **Step 4: Run focused GREEN**

```text
pnpm --filter @blocksync/project-store-sqlite test -- \
  src/migrations/legacy-backfill-integration.test.ts \
  src/migrations/target-schema.test.ts \
  src/migrations/adoption.test.ts \
  src/migrations/concurrency.test.ts \
  src/workspace-migration-fixture.test.ts
```

- [ ] **Step 5: Run final gates**

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
- r1-baseline-fingerprints.json has no diff
- r1-target-schema-fingerprint.json has no diff
- committed legacy-r1.sqlite / manifest / snapshots have no diff
- no legacy-r1.sqlite-wal or legacy-r1.sqlite-shm exists
- docs/ai-platform/ is not staged
- fixture:legacy-r1 still produces user_version 0 with no schema_migrations
```

- [ ] **Step 6: Commit**

```bash
git add packages/project-store-sqlite/src/migrations/index.ts \
  packages/project-store-sqlite/src/migrations/legacy-backfill-integration.test.ts \
  packages/project-store-sqlite/src/migrations/target-schema.test.ts \
  packages/project-store-sqlite/src/migrations/adoption.test.ts \
  packages/project-store-sqlite/src/migrations/concurrency.test.ts \
  packages/project-store-sqlite/src/workspace-migration-fixture.test.ts \
  docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md
git commit -m "test(store): prove legacy backfill integration and race"
```

---

## Plan Completion Gate

- Production registry is immutable and gapless `[1..5]`.
- Every non-empty legacy backfill has a verified, non-overwritten backup.
- Backup/live digest equality is rechecked under the version 5 write lock.
- All target IDs and source-derived timestamps are deterministic.
- Membership and role mapping never broadens access.
- Suspended organizations and disabled users have no active assignments.
- Legacy sessions are revoked atomically with the target rows.
- Fresh/copied/invalid/backup-failure/fault/retry/race contracts pass.
- V1 envelope, revision, snapshot, asset, and transaction evidence is
  unchanged.
- Versions 1-4 and both committed fingerprint artifacts are byte-unchanged.
- Production non-migration code still does not consume the target schema.
- All final gates are green and `docs/ai-platform/` is unstaged.

After this plan is implemented and formally approved, create a separate design
for repository ports/adapters and directory-service invariants. Do not fold
that work into version 5.
