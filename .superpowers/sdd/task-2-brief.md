# Task 2: Browser-safe project and SB3 core

## Goal

Provide browser-safe project hashing, LocalProjectRecord validation, and SB3 import/export entry points without changing the published ProjectEnvelopeV1 contract or breaking Node callers.

## Required behavior

1. Preserve every existing `@blocksync/project-envelope` public export and byte/hash result.
2. Replace direct Node-only hashing in reusable code with a synchronous browser-safe implementation. `contentHash`, `requestHash`, canonicalization, stable target IDs, SHA-256 asset hashes, and MD5 SB3 asset checks must retain existing vectors.
3. Isolate `loadSb3Isolated` and its `node:child_process`, `node:path`, and `node:url` dependencies behind a Node-only SB3 entry point. Add a browser entry point that exports normal load/export/canonical/media verification but cannot pull Node built-ins into a browser bundle.
4. Add `@blocksync/project-local-core` with a versioned `blocksync.local-project/v1` record. It contains local project ID, title, revision, updatedAt, ProjectDocument, asset byte records, save state, and optional Drive file ID. It must not contain or accept `organizationId` or `updatedByUserId`.
5. Validate LocalProjectRecord structure and call the existing ProjectDocument validator. Reject malformed assets, negative/non-integer revisions, invalid dates, unknown format, and server identity fields. Preserve typed-array bytes.
6. Add a build test that bundles browser entry points and fails if `node:` imports or browser-external stubs remain. Existing Node tests and type checks must continue to pass.

## Suggested structure

- Factor browser-safe SB3 functions from `packages/sb3-tools/src/index.ts` into a core module.
- Keep `packages/sb3-tools/src/index.ts` backward-compatible by re-exporting the browser-safe core and Node isolated loader.
- Export browser-safe API as `@blocksync/sb3-tools/browser` and isolated loader as `@blocksync/sb3-tools/node`.
- Use a small audited browser-safe hash dependency rather than implementing cryptography manually. Pin the dependency version and update `pnpm-lock.yaml`.
- Add `packages/project-local-core/` following existing TypeScript/Vitest package conventions.

## TDD and tests

- Write failing vector/bundle/local-record tests first and run them to observe the expected failures.
- Reuse existing project-envelope and SB3 vectors.
- Include a browser bundle smoke that actually invokes project hashing and SB3 browser exports.
- Run tests and typechecks for project-envelope, project-local-core, sb3-tools, and affected dependents.
- Run the workspace build or the narrowest equivalent that proves no regressions.

## Constraints

- Do not change ProjectEnvelopeV1 fields, canonical JSON, request material, or hash values.
- Do not change SB3 safety limits or accepted/rejected media semantics.
- Do not add IndexedDB, UI, Drive, WebRTC, Apps Script, or School Server changes in this task.
- Preserve existing package public exports.
- Follow the repository conventions and Conventional Commits.

## Deliverable

Implement, self-review, commit, and write the detailed report to `.superpowers/sdd/task-2-report.md`, including RED/GREEN commands and exact test results.
### Task 2: Failing SQLite enrollment contracts

**Files:**
- Modify: `packages/project-store-sqlite/src/directory-repository.contract.test.ts`
- Modify: `packages/project-store-sqlite/src/directory-repository.ts`

**Interfaces:**
- Consumes: Task 1 port methods
- Produces: a compiling adapter stub plus RED behavior contracts

- [ ] **Step 1: Add a deterministic enrollment fixture helper**

Inside the existing writes `describe`, add a helper which opens a fresh migrated file DB, registers its close callback, and seeds exact hierarchy rows:

```ts
function openEnrollmentDb(prefix: string) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  const db = openMigratedDb(join(dir, "db.sqlite"));
  closers.push(() => db.close());
  db.exec(`
    INSERT INTO workspaces(id, kind, name, created_at, updated_at)
    VALUES
      ('ws-school','school','School','2026-07-18T00:00:00.000Z','2026-07-18T00:00:00.000Z'),
      ('ws-foreign','school','Foreign','2026-07-18T00:00:00.000Z','2026-07-18T00:00:00.000Z');
    INSERT INTO workspace_directory_revisions(workspace_id, revision, updated_at)
    VALUES
      ('ws-school',0,'2026-07-18T00:00:00.000Z'),
      ('ws-foreign',0,'2026-07-18T00:00:00.000Z');
    INSERT INTO schools(id, workspace_id, name, created_at, updated_at)
    VALUES
      ('school-1','ws-school','School','2026-07-18T00:00:00.000Z','2026-07-18T00:00:00.000Z'),
      ('school-foreign','ws-foreign','Foreign','2026-07-18T00:00:00.000Z','2026-07-18T00:00:00.000Z');
    INSERT INTO academic_years(id, school_id, label, start_date, end_date, status)
    VALUES
      ('year-1','school-1','2026','2026-04-01','2027-03-31','active'),
      ('year-foreign','school-foreign','2026','2026-04-01','2027-03-31','active');
    INSERT INTO grades(id, academic_year_id, code, display_label, sort_order)
    VALUES
      ('grade-1','year-1','1','Grade 1',1),
      ('grade-foreign','year-foreign','1','Grade 1',1);
    INSERT INTO class_groups(id, academic_year_id, grade_id, label)
    VALUES
      ('class-1','year-1','grade-1','Class 1'),
      ('class-foreign','year-foreign','grade-foreign','Foreign Class');
    INSERT INTO people(id, display_name, status, created_at, updated_at)
    VALUES
      ('person-1','Person 1','active','2026-07-18T00:00:00.000Z','2026-07-18T00:00:00.000Z'),
      ('person-2','Person 2','active','2026-07-18T00:00:00.000Z','2026-07-18T00:00:00.000Z'),
      ('person-3','Person 3','active','2026-07-18T00:00:00.000Z','2026-07-18T00:00:00.000Z');
  `);
  return {
    db,
    repo: createSqliteWorkspaceDirectoryRepository(db),
    workspaceId: "ws-school",
    foreignWorkspaceId: "ws-foreign",
  };
}
```

- [ ] **Step 2: Add five behavior contracts**

Use active enrollment objects with `endDate: null`:

1. Create `enrollment-1` for `person-1`, `class-1`, attendance `"12"`; assert revision 1 and `getEnrollment` round-trip.
2. Create `enrollment-1`, then create `enrollment-2` for `person-2` with the same class/attendance; assert `DIRECTORY_CONFLICT`, revision remains 1, second row is absent.
3. Create two enrollments for different people with `attendanceNumber: null`; assert both succeed and revision reaches 2.
4. Try `class-foreign` while passing `workspaceId: "ws-school"`; assert `DIRECTORY_NOT_FOUND`, both workspace revisions remain 0, row absent.
5. Try a valid enrollment with stale `expectedRevision: -1`; assert `DIRECTORY_REVISION_CONFLICT`, revision remains 0, row absent.
6. Try a valid enrollment with `updatedAt: "not-a-utc-date-time"`; assert `DIRECTORY_INVALID`, revision remains 0, row absent.

Use explicit `updatedAt` values such as `2026-07-18T01:00:00.000Z` and advance them for sequential writes.

- [ ] **Step 3: Add compiling adapter stubs**

Add `Enrollment` / `validateEnrollment` imports as needed. Add `getEnrollment` returning `null` and `createEnrollment` throwing:

```ts
throw new DirectoryError("DIRECTORY_INVALID", "enrollment write not implemented");
```

- [ ] **Step 4: Run the focused contracts to verify RED**

The invalid-`updatedAt` contract also asserts a `UtcDateTime` validation
message, so it fails against the generic enrollment stub.

Run:

```bash
pnpm --filter @blocksync/project-store-sqlite test -- src/directory-repository.contract.test.ts
```

Expected: the six new cases fail on the stubs; pre-existing cases stay green.

- [ ] **Step 5: Commit the RED contracts and stubs**

```bash
git add packages/project-store-sqlite/src/directory-repository.ts \
  packages/project-store-sqlite/src/directory-repository.contract.test.ts
git commit -m "test(store): add failing enrollment uniqueness contracts"
```

---

