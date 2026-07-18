# R1 Directory Enrollment Update/End Design

**Date:** 2026-07-18
**Status:** Approved design
**Predecessor:** [R1 Directory Attendance Uniqueness](2026-07-18-r1-directory-attendance-uniqueness-design.md)
**Roadmap:** [R1 Workspace Roster Access Plan, Phase 3 Task 4](../plans/2026-07-16-r1-workspace-roster-access-plan.md) (enrollment update/end thin slice)

## 1. Goal

Extend `WorkspaceDirectoryRepository` with CAS-gated `updateEnrollment` and
`endEnrollment` so active enrollment rows can change attendance number / start
date, or end, while preserving the existing partial UNIQUE indexes:

```sql
CREATE UNIQUE INDEX ux_enroll_active_attendance
  ON enrollments(class_group_id, attendance_number)
  WHERE status = 'active' AND attendance_number IS NOT NULL;

CREATE UNIQUE INDEX ux_enroll_active_person_class
  ON enrollments(person_id, class_group_id) WHERE status = 'active';
```

Class moves remain out of band: callers end the old enrollment and create a new
one. Date-overlap uniqueness stays deferred to a later service layer.

## 2. Non-goals

- Changing `personId` or `classGroupId` on an existing row
- Calling or changing `findAttendanceNumberConflicts`
- school / academic year / grade / class write APIs
- claim / System Owner / transfer / audit / API / UI
- History rows, soft-delete alternatives, or re-activate of ended enrollments
- Changing CAS / IMMEDIATE / constraint-mapping helpers beyond enrollment call sites

## 3. Port surface

```ts
updateEnrollment(input: {
  workspaceId: string;
  expectedRevision: number;
  updatedAt: string; // UtcDateTime for directory revision bump
  enrollmentId: string;
  patch: {
    attendanceNumber?: string | null;
    startDate?: string; // IsoDate
  };
}): {revision: number; enrollment: Enrollment};

endEnrollment(input: {
  workspaceId: string;
  expectedRevision: number;
  updatedAt: string; // UtcDateTime for directory revision bump
  enrollmentId: string;
  endDate: string; // IsoDate
}): {revision: number; enrollment: Enrollment};
```

### Patch rules (`updateEnrollment`)

Allowed keys: `attendanceNumber`, `startDate` only.

- Empty patch (`{}` or no allowed keys present) → `DIRECTORY_INVALID`
- Unknown keys on `patch` (any key other than the two above) → `DIRECTORY_INVALID`
- Runtime check must reject unknown fields even when TypeScript callers are
  typed narrowly (adapters receive plain objects at the system boundary)

### Active-only updates

Both `updateEnrollment` and `endEnrollment` target **active** rows only.

- Missing id, foreign-tenant workspace, or **already `ended`** →
  `DIRECTORY_NOT_FOUND` (existence hiding; do not reveal that the id exists)
- `updateEnrollment` never sets `status` or `endDate`; the row remains
  `status = 'active'` and `endDate = null` after a successful patch
- Ending is only via `endEnrollment`

## 4. Adapter algorithm

Shared preamble for both methods (inside sync `withTransaction` /
`BEGIN IMMEDIATE`):

1. `parseUtcDateTime(updatedAt)` → fail → `DIRECTORY_INVALID` (before any
   directory read/write)
2. Load the enrollment with the same ownership join used by
   `getEnrollment(workspaceId, enrollmentId)`.
   Missing / foreign workspace / `status !== 'active'` →
   `DIRECTORY_NOT_FOUND`
3. Build the next `Enrollment` value, then `validateEnrollment` → fail →
   `DIRECTORY_INVALID`
4. `assertAndBumpRevision(workspaceId, expectedRevision, parsedUpdatedAt)`
5. `UPDATE … WHERE id = ?` via `runMappedConstraint`
   - UNIQUE / PRIMARY KEY → `DIRECTORY_CONFLICT`
   - FOREIGN KEY → `DIRECTORY_NOT_FOUND`
   - other `SQLITE_CONSTRAINT*` → `DIRECTORY_INVALID`
6. Return `{ revision, enrollment }`

Failed writes roll back DML and the revision bump with the transaction.

### `updateEnrollment` specifics

1. Reject empty or unknown-key patches as above
2. Merge patch onto the loaded active row (`personId` / `classGroupId` /
   `status` / `endDate` unchanged)
3. Proceed with shared steps 3–6

### `endEnrollment` specifics

1. Set `status = 'ended'` and `endDate = input.endDate`
2. Proceed with shared steps 3–6 (`validateEnrollment` enforces
   active/ended ↔ endDate consistency)

Do not call `findAttendanceNumberConflicts`.

## 5. Error contract (this slice)

| Code | When |
|---|---|
| `DIRECTORY_INVALID` | Bad `updatedAt`; empty/unknown patch; domain validation failure |
| `DIRECTORY_NOT_FOUND` | Missing / foreign-tenant / already-ended enrollment (update or end) |
| `DIRECTORY_REVISION_CONFLICT` | Stale `expectedRevision` |
| `DIRECTORY_CONFLICT` | Active attendance or person+class UNIQUE after update |

## 6. Testing

Reuse the enrollment SQL seed from the attendance uniqueness contracts.

1. Update `attendanceNumber` on an active row → revision +1; round-trip
2. Update to a duplicate active non-null attendance in the same class →
   `DIRECTORY_CONFLICT`; revision unchanged; row unchanged
3. End an active enrollment → `status='ended'`, `endDate` set; revision +1
4. End again (or update after end) → `DIRECTORY_NOT_FOUND`; revision unchanged
5. Foreign `workspaceId` on update or end → `DIRECTORY_NOT_FOUND`; both
   workspace revisions unchanged
6. Stale `expectedRevision` → `DIRECTORY_REVISION_CONFLICT`
7. Invalid `updatedAt` → `DIRECTORY_INVALID` with a `UtcDateTime` message;
   revision unchanged
8. Empty patch and unknown patch key → `DIRECTORY_INVALID`; revision unchanged

### Gates

- `pnpm --filter @blocksync/workspace-directory test`
- `pnpm --filter @blocksync/workspace-directory typecheck`
- `pnpm --filter @blocksync/project-store-sqlite test -- src/directory-repository.contract.test.ts`
- `pnpm --filter @blocksync/project-store-sqlite typecheck`
- `pnpm r1:persist:test` before handoff

## 7. Files

| Path | Change |
|---|---|
| `packages/workspace-directory/src/repository.ts` | Add port methods |
| `packages/workspace-directory/src/repository.test.ts` | Type smoke |
| `packages/project-store-sqlite/src/directory-repository.ts` | Implement |
| `packages/project-store-sqlite/src/directory-repository.contract.test.ts` | Cases above |
| Predecessor attendance uniqueness design | Note update/end follow-on landed |
| `docs/superpowers/plans/2026-07-16-r1-workspace-roster-access-plan.md` | Thin-slice note |
| `docs/CURSOR_CODEX_HANDOFF.md` | Slice status |

## 8. Follow-ons

- Service-layer date-overlap checks via `findAttendanceNumberConflicts`
- Class-move helper (orchestrated end + create) if needed at service layer
- claim / System Owner transfer / audit / Task 5 school roster lifecycle
