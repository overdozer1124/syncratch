# R1 Directory Attendance Uniqueness Design

**Date:** 2026-07-18
**Status:** Approved design
**Predecessor:** [R1 Workspace Directory Repositories](2026-07-18-r1-workspace-directory-repositories-design.md)
**Roadmap:** [R1 Workspace Roster Access Plan, Phase 3 Task 4](../plans/2026-07-16-r1-workspace-roster-access-plan.md) (attendance uniqueness thin slice)

## 1. Goal

Add minimal enrollment write/read methods on `WorkspaceDirectoryRepository` so
that **active attendance-number uniqueness** is enforced transactionally via
the existing partial UNIQUE index:

```sql
CREATE UNIQUE INDEX ux_enroll_active_attendance
  ON enrollments(class_group_id, attendance_number)
  WHERE status = 'active' AND attendance_number IS NOT NULL;
```

Duplicate active numbers in the same class map to `DIRECTORY_CONFLICT`.
`attendanceNumber: null` is allowed for multiple concurrent actives.

## 2. Non-goals

- `updateEnrollment` / `endEnrollment`
- school / academic year / grade / class write APIs (tests seed via SQL)
- Date-overlap-only uniqueness (domain `findAttendanceNumberConflicts` stays
  as-is for later service use; this slice follows the DB UNIQUE semantics)
- claim / System Owner / transfer / audit / API / UI
- Changing CAS, BOLA, or constraint-mapping helpers beyond enrollment call sites

## 3. Port surface

Extend `WorkspaceDirectoryRepositoryTx`:

```ts
getEnrollment(enrollmentId: string): Enrollment | null;

createEnrollment(input: {
  workspaceId: string;
  expectedRevision: number;
  updatedAt: string; // UtcDateTime for directory revision bump
  enrollment: Enrollment;
}): {revision: number; enrollment: Enrollment};
```

Import `Enrollment` / `validateEnrollment` from existing models.

## 4. Adapter algorithm

Inside the existing sync `withTransaction` / shared `db`:

1. `validateEnrollment(enrollment)` → fail → `DIRECTORY_INVALID`
2. Resolve class ownership:
   ```sql
   SELECT s.workspace_id AS workspaceId
   FROM class_groups cg
   JOIN academic_years ay ON ay.id = cg.academic_year_id
   JOIN schools s ON s.id = ay.school_id
   WHERE cg.id = ?
   ```
   Missing row **or** `workspaceId !== input.workspaceId` →
   `DIRECTORY_NOT_FOUND`
3. `assertAndBumpRevision(workspaceId, expectedRevision, updatedAt)`
4. `INSERT INTO enrollments …` via `runMappedConstraint`
   - `SQLITE_CONSTRAINT_UNIQUE` / `PRIMARYKEY` → `DIRECTORY_CONFLICT`
     (covers attendance UNIQUE and `ux_enroll_active_person_class`)
   - `SQLITE_CONSTRAINT_FOREIGNKEY` → `DIRECTORY_NOT_FOUND`
   - other `SQLITE_CONSTRAINT*` → `DIRECTORY_INVALID`
5. Return `{ revision, enrollment: validated }`

`getEnrollment` maps a row through `validateEnrollment` (or `null`).

Do not call `findAttendanceNumberConflicts` in the adapter for this slice.

## 5. Testing

Contract tests on a migrated empty/fresh DB with SQL seed of
workspace (kind `school`) + school + academic year + grade + class + people
+ `workspace_directory_revisions` (same shape as
`0003-r1-school-roster.test.ts` helpers):

1. Successful create → revision +1; `getEnrollment` returns the row
2. Second active enrollment same class + same non-null attendance →
   `DIRECTORY_CONFLICT`; revision unchanged
3. Two actives with `attendanceNumber: null` succeed
4. Class belonging to another workspace → `DIRECTORY_NOT_FOUND`; revision
   unchanged
5. Stale `expectedRevision` → `DIRECTORY_REVISION_CONFLICT`

### Gates

- `pnpm --filter @blocksync/workspace-directory test`
- `pnpm --filter @blocksync/workspace-directory typecheck`
- `pnpm --filter @blocksync/project-store-sqlite test -- src/directory-repository.contract.test.ts`
- `pnpm --filter @blocksync/project-store-sqlite typecheck`

## 6. Files

| Path | Change |
|---|---|
| `packages/workspace-directory/src/repository.ts` | Add methods |
| `packages/workspace-directory/src/repository.test.ts` | Optional type smoke |
| `packages/project-store-sqlite/src/directory-repository.ts` | Implement |
| `packages/project-store-sqlite/src/directory-repository.contract.test.ts` | Cases above |
| Predecessor design (optional) | Note enrollment thin write + UNIQUE |
| `docs/CURSOR_CODEX_HANDOFF.md` | Slice status at implementation time |
| `docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md` | Note thin attendance slice |

## 7. Follow-ons

- `updateEnrollment` / `endEnrollment` with the same UNIQUE semantics
- Service-layer date-overlap checks using `findAttendanceNumberConflicts`
- Full school hierarchy write APIs (Task 5)
- claim / audit slices
