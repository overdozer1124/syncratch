import {describe, expect, it} from "vitest";
import {
  parseAcademicYearId,
  parseAuditEventId,
  parseClassGroupId,
  parseDirectoryRevision,
  parseEnrollmentId,
  parseGradeId,
  parseIsoDate,
  parsePersonAccountLinkId,
  parsePersonId,
  parseRoleAssignmentId,
  parseSchoolId,
  parseStaffAssignmentId,
  parseUserAccountId,
  parseUtcDateTime,
  parseWorkspaceId,
  parseWorkspaceMembershipId,
} from "./ids.js";
import {
  validateAcademicYear,
  validateAuditEvent,
  validateClassGroup,
  validateEnrollment,
  validateGrade,
  validatePerson,
  validatePersonAccountLink,
  validateRoleAssignment,
  validateSchool,
  validateStaffAssignment,
  validateWorkspace,
  validateWorkspaceMembership,
} from "./models.js";

function valueOf<T>(result: {ok: true; value: T} | {ok: false}): T {
  if (!result.ok) {
    throw new Error("invalid test fixture");
  }
  return result.value;
}

const personId = valueOf(parsePersonId("person-1"));
const accountId = valueOf(parseUserAccountId("account-1"));
const workspaceId = valueOf(parseWorkspaceId("workspace-1"));
const schoolId = valueOf(parseSchoolId("school-1"));
const academicYearId = valueOf(parseAcademicYearId("year-1"));
const gradeId = valueOf(parseGradeId("grade-1"));
const classGroupId = valueOf(parseClassGroupId("class-1"));
const enrollmentId = valueOf(parseEnrollmentId("enrollment-1"));
const staffAssignmentId = valueOf(
  parseStaffAssignmentId("staff-assignment-1"),
);
const roleAssignmentId = valueOf(parseRoleAssignmentId("role-assignment-1"));
const linkId = valueOf(parsePersonAccountLinkId("link-1"));
const membershipId = valueOf(
  parseWorkspaceMembershipId("membership-1"),
);
const auditEventId = valueOf(parseAuditEventId("audit-1"));
const startDate = valueOf(parseIsoDate("2026-04-01"));
const endDate = valueOf(parseIsoDate("2027-03-31"));
const earlierDate = valueOf(parseIsoDate("2026-03-31"));
const now = valueOf(parseUtcDateTime("2026-07-17T12:00:00.000Z"));
const later = valueOf(parseUtcDateTime("2026-07-18T12:00:00.000Z"));
const earlier = valueOf(parseUtcDateTime("2026-07-16T12:00:00.000Z"));
const nowWithoutMilliseconds = valueOf(
  parseUtcDateTime("2026-07-17T12:00:00Z"),
);
const revision = valueOf(parseDirectoryRevision(3));

describe("workspace-directory models", () => {
  it("validates Person names, statuses, and timestamp order", () => {
    const valid = {
      id: personId,
      displayName: "Ada",
      status: "active" as const,
      createdAt: now,
      updatedAt: later,
    };

    expect(validatePerson(valid)).toEqual({ok: true, value: valid});
    expect(validatePerson({...valid, displayName: " "})).toMatchObject({
      ok: false,
    });
    expect(
      validatePerson({...valid, status: "unknown" as never}),
    ).toMatchObject({ok: false});
    expect(
      validatePerson({...valid, createdAt: later, updatedAt: now}),
    ).toMatchObject({ok: false});
    expect(
      validatePerson({
        ...valid,
        createdAt: nowWithoutMilliseconds,
        updatedAt: now,
      }),
    ).toMatchObject({ok: true});
  });

  it("validates PersonAccountLink status and unlink timestamp consistency", () => {
    const active = {
      id: linkId,
      personId,
      accountId,
      status: "active" as const,
      linkedAt: now,
      unlinkedAt: null,
    };

    expect(validatePersonAccountLink(active)).toMatchObject({ok: true});
    expect(
      validatePersonAccountLink({...active, unlinkedAt: later}),
    ).toMatchObject({ok: false});
    expect(
      validatePersonAccountLink({
        ...active,
        status: "unlinked",
        unlinkedAt: later,
      }),
    ).toMatchObject({ok: true});
    expect(
      validatePersonAccountLink({
        ...active,
        status: "unlinked",
        unlinkedAt: null,
      }),
    ).toMatchObject({ok: false});
    expect(
      validatePersonAccountLink({
        ...active,
        status: "unlinked",
        unlinkedAt: earlier,
      }),
    ).toMatchObject({ok: false});
  });

  it("validates Workspace and WorkspaceMembership fields", () => {
    const workspace = {
      id: workspaceId,
      kind: "school" as const,
      name: "North",
      createdAt: now,
      updatedAt: later,
    };
    const membership = {
      id: membershipId,
      workspaceId,
      accountId,
      role: "member" as const,
      status: "active" as const,
      startedAt: now,
      endedAt: null,
    };

    expect(validateWorkspace(workspace)).toMatchObject({ok: true});
    expect(validateWorkspace({...workspace, name: ""})).toMatchObject({
      ok: false,
    });
    expect(
      validateWorkspace({...workspace, kind: "enterprise" as never}),
    ).toMatchObject({ok: false});
    expect(validateWorkspaceMembership(membership)).toMatchObject({ok: true});
    expect(
      validateWorkspaceMembership({...membership, endedAt: later}),
    ).toMatchObject({ok: false});
    expect(
      validateWorkspaceMembership({
        ...membership,
        status: "ended",
        endedAt: later,
      }),
    ).toMatchObject({ok: true});
    expect(
      validateWorkspaceMembership({
        ...membership,
        status: "ended",
        endedAt: null,
      }),
    ).toMatchObject({ok: false});
  });

  it("validates school, academic year, grade, and class labels", () => {
    const school = {
      id: schoolId,
      workspaceId,
      name: "North School",
      createdAt: now,
      updatedAt: later,
    };
    const year = {
      id: academicYearId,
      schoolId,
      label: "2026",
      startDate,
      endDate,
      status: "active" as const,
    };
    const grade = {
      id: gradeId,
      academicYearId,
      code: "G1",
      displayLabel: "Grade 1",
      sortOrder: 0,
    };
    const classGroup = {
      id: classGroupId,
      academicYearId,
      gradeId,
      label: "1-A",
    };

    expect(validateSchool(school)).toMatchObject({ok: true});
    expect(validateSchool({...school, name: " "})).toMatchObject({ok: false});
    expect(validateAcademicYear(year)).toMatchObject({ok: true});
    expect(
      validateAcademicYear({...year, label: "", status: "open" as never}),
    ).toMatchObject({ok: false});
    expect(
      validateAcademicYear({...year, startDate: endDate, endDate: startDate}),
    ).toMatchObject({ok: false});
    expect(validateGrade(grade)).toMatchObject({ok: true});
    expect(validateGrade({...grade, code: ""})).toMatchObject({ok: false});
    expect(validateGrade({...grade, displayLabel: " "})).toMatchObject({
      ok: false,
    });
    expect(validateGrade({...grade, sortOrder: -1})).toMatchObject({
      ok: false,
    });
    expect(validateGrade({...grade, sortOrder: 1.5})).toMatchObject({
      ok: false,
    });
    expect(validateClassGroup(classGroup)).toMatchObject({ok: true});
    expect(validateClassGroup({...classGroup, label: " "})).toMatchObject({
      ok: false,
    });
  });

  it("requires enrollment date order and status/endDate consistency", () => {
    const active = {
      id: enrollmentId,
      personId,
      classGroupId,
      status: "active" as const,
      startDate,
      endDate: null,
      attendanceNumber: null,
    };

    expect(validateEnrollment(active)).toMatchObject({ok: true});
    expect(
      validateEnrollment({...active, attendanceNumber: " 12 "}),
    ).toMatchObject({ok: true});
    expect(
      validateEnrollment({...active, attendanceNumber: " "}),
    ).toMatchObject({ok: false});
    expect(
      validateEnrollment({...active, endDate}),
    ).toMatchObject({ok: false});
    expect(
      validateEnrollment({...active, status: "ended", endDate}),
    ).toMatchObject({ok: true});
    expect(
      validateEnrollment({...active, status: "ended", endDate: null}),
    ).toMatchObject({ok: false});
    expect(
      validateEnrollment({
        ...active,
        status: "ended",
        startDate,
        endDate: earlierDate,
      }),
    ).toMatchObject({ok: false});
  });

  it("validates staff assignment role, dates, and status/endDate consistency", () => {
    const active = {
      id: staffAssignmentId,
      personId,
      classGroupId,
      role: "teacher" as const,
      status: "active" as const,
      startDate,
      endDate: null,
    };

    expect(validateStaffAssignment(active)).toMatchObject({ok: true});
    expect(
      validateStaffAssignment({...active, role: "principal" as never}),
    ).toMatchObject({ok: false});
    expect(
      validateStaffAssignment({...active, endDate}),
    ).toMatchObject({ok: false});
    expect(
      validateStaffAssignment({...active, status: "ended", endDate}),
    ).toMatchObject({ok: true});
    expect(
      validateStaffAssignment({
        ...active,
        status: "ended",
        endDate: earlierDate,
      }),
    ).toMatchObject({ok: false});
  });

  it("validates every scoped RoleAssignment variant", () => {
    const shared = {
      id: roleAssignmentId,
      accountId,
      status: "active" as const,
      startedAt: now,
      endedAt: null,
    };
    const validAssignments = [
      {...shared, scope: {kind: "system" as const}, role: "operator" as const},
      {
        ...shared,
        scope: {kind: "workspace" as const, workspaceId},
        role: "admin" as const,
      },
      {
        ...shared,
        scope: {kind: "school" as const, schoolId},
        role: "school_admin" as const,
      },
      {
        ...shared,
        scope: {kind: "class" as const, classGroupId},
        role: "assistant" as const,
      },
      {
        ...shared,
        scope: {kind: "project" as const, projectId: "project-1"},
        role: "viewer" as const,
      },
    ];

    for (const assignment of validAssignments) {
      expect(validateRoleAssignment(assignment)).toMatchObject({ok: true});
    }

    expect(
      validateRoleAssignment({
        ...shared,
        scope: {kind: "system"},
        role: "admin",
      } as never),
    ).toMatchObject({ok: false});
    expect(
      validateRoleAssignment({
        ...shared,
        scope: {kind: "workspace", workspaceId},
        role: "teacher",
      } as never),
    ).toMatchObject({ok: false});
    expect(
      validateRoleAssignment({
        ...shared,
        scope: {kind: "project", projectId: " "},
        role: "viewer",
      }),
    ).toMatchObject({ok: false});
    expect(
      validateRoleAssignment({...validAssignments[0], endedAt: later}),
    ).toMatchObject({ok: false});
    expect(
      validateRoleAssignment({
        ...validAssignments[0],
        status: "ended",
        endedAt: later,
      }),
    ).toMatchObject({ok: true});
    expect(
      validateRoleAssignment({
        ...validAssignments[0],
        status: "ended",
        endedAt: earlier,
      }),
    ).toMatchObject({ok: false});
  });

  it("validates non-empty AuditEvent fields", () => {
    const event = {
      id: auditEventId,
      workspaceId,
      actorAccountId: accountId,
      action: "directory.person.updated",
      subjectType: "person",
      subjectId: personId,
      payload: {displayName: "Ada"},
      createdAt: now,
      directoryRevision: revision,
    };

    expect(validateAuditEvent(event)).toEqual({ok: true, value: event});
    expect(validateAuditEvent({...event, action: " "})).toMatchObject({
      ok: false,
    });
    expect(validateAuditEvent({...event, subjectType: ""})).toMatchObject({
      ok: false,
    });
    expect(validateAuditEvent({...event, subjectId: " "})).toMatchObject({
      ok: false,
    });
  });
});
