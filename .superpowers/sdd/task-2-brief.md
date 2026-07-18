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

