import {describe, expect, it} from "vitest";
import {
  parseClassGroupId,
  parseEnrollmentId,
  parseIsoDate,
  parsePersonAccountLinkId,
  parsePersonId,
  parseSchoolId,
  parseUserAccountId,
  parseUtcDateTime,
  parseWorkspaceId,
} from "./ids.js";
import type {
  Enrollment,
  PersonAccountLink,
  School,
  Workspace,
} from "./models.js";
import {
  assertSchoolWorkspaceKind,
  findActiveAccountLinkConflicts,
  findAttendanceNumberConflicts,
  findOverlappingEnrollmentConflicts,
} from "./conflicts.js";

function valueOf<T>(result: {ok: true; value: T} | {ok: false}): T {
  if (!result.ok) {
    throw new Error("invalid test fixture");
  }
  return result.value;
}

const personA = valueOf(parsePersonId("person-a"));
const personB = valueOf(parsePersonId("person-b"));
const accountA = valueOf(parseUserAccountId("account-a"));
const accountB = valueOf(parseUserAccountId("account-b"));
const classA = valueOf(parseClassGroupId("class-a"));
const classB = valueOf(parseClassGroupId("class-b"));
const workspaceId = valueOf(parseWorkspaceId("workspace-1"));
const otherWorkspaceId = valueOf(parseWorkspaceId("workspace-2"));
const schoolId = valueOf(parseSchoolId("school-1"));
const now = valueOf(parseUtcDateTime("2026-07-17T12:00:00.000Z"));
const later = valueOf(parseUtcDateTime("2026-07-18T12:00:00.000Z"));
const start = valueOf(parseIsoDate("2026-04-01"));
const mid = valueOf(parseIsoDate("2026-09-30"));
const next = valueOf(parseIsoDate("2026-10-01"));
const end = valueOf(parseIsoDate("2027-03-31"));

function link(
  overrides: Partial<PersonAccountLink> &
    Pick<PersonAccountLink, "id" | "personId" | "accountId">,
): PersonAccountLink {
  return {
    status: "active",
    linkedAt: now,
    unlinkedAt: null,
    ...overrides,
  };
}

function enrollment(
  overrides: Partial<Enrollment> &
    Pick<Enrollment, "id" | "personId" | "classGroupId">,
): Enrollment {
  return {
    status: "active",
    startDate: start,
    endDate: null,
    attendanceNumber: null,
    ...overrides,
  };
}

describe("findActiveAccountLinkConflicts", () => {
  it("detects two active links for one account across people", () => {
    const issues = findActiveAccountLinkConflicts([
      link({
        id: valueOf(parsePersonAccountLinkId("link-1")),
        personId: personA,
        accountId: accountA,
      }),
      link({
        id: valueOf(parsePersonAccountLinkId("link-2")),
        personId: personB,
        accountId: accountA,
      }),
    ]);

    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((issue) => issue.code.includes("account"))).toBe(true);
  });

  it("detects two active links for one person across accounts", () => {
    const issues = findActiveAccountLinkConflicts([
      link({
        id: valueOf(parsePersonAccountLinkId("link-1")),
        personId: personA,
        accountId: accountA,
      }),
      link({
        id: valueOf(parsePersonAccountLinkId("link-2")),
        personId: personA,
        accountId: accountB,
      }),
    ]);

    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((issue) => issue.code.includes("person"))).toBe(true);
  });

  it("allows historical unlinked rows for the same account", () => {
    const issues = findActiveAccountLinkConflicts([
      link({
        id: valueOf(parsePersonAccountLinkId("link-1")),
        personId: personA,
        accountId: accountA,
        status: "unlinked",
        unlinkedAt: later,
      }),
      link({
        id: valueOf(parsePersonAccountLinkId("link-2")),
        personId: personB,
        accountId: accountA,
      }),
    ]);

    expect(issues).toEqual([]);
  });

  it("allows one active link per account and person", () => {
    expect(
      findActiveAccountLinkConflicts([
        link({
          id: valueOf(parsePersonAccountLinkId("link-1")),
          personId: personA,
          accountId: accountA,
        }),
        link({
          id: valueOf(parsePersonAccountLinkId("link-2")),
          personId: personB,
          accountId: accountB,
        }),
      ]),
    ).toEqual([]);
  });
});

describe("findOverlappingEnrollmentConflicts", () => {
  it("detects overlapping active enrollments for the same person/class", () => {
    const issues = findOverlappingEnrollmentConflicts([
      enrollment({
        id: valueOf(parseEnrollmentId("enr-1")),
        personId: personA,
        classGroupId: classA,
        endDate: null,
      }),
      enrollment({
        id: valueOf(parseEnrollmentId("enr-2")),
        personId: personA,
        classGroupId: classA,
        startDate: mid,
        endDate: end,
      }),
    ]);

    expect(issues.length).toBeGreaterThan(0);
  });

  it("treats inclusive ranges as overlapping when end equals other start", () => {
    const issues = findOverlappingEnrollmentConflicts([
      enrollment({
        id: valueOf(parseEnrollmentId("enr-1")),
        personId: personA,
        classGroupId: classA,
        endDate: mid,
      }),
      enrollment({
        id: valueOf(parseEnrollmentId("enr-2")),
        personId: personA,
        classGroupId: classA,
        startDate: mid,
        endDate: end,
      }),
    ]);

    expect(issues.length).toBeGreaterThan(0);
  });

  it("allows non-overlapping enrollment history", () => {
    expect(
      findOverlappingEnrollmentConflicts([
        enrollment({
          id: valueOf(parseEnrollmentId("enr-1")),
          personId: personA,
          classGroupId: classA,
          endDate: mid,
        }),
        enrollment({
          id: valueOf(parseEnrollmentId("enr-2")),
          personId: personA,
          classGroupId: classA,
          startDate: next,
          endDate: end,
        }),
      ]),
    ).toEqual([]);
  });

  it("ignores ended enrollments and different classes or people", () => {
    expect(
      findOverlappingEnrollmentConflicts([
        enrollment({
          id: valueOf(parseEnrollmentId("enr-1")),
          personId: personA,
          classGroupId: classA,
          status: "ended",
          endDate: end,
        }),
        enrollment({
          id: valueOf(parseEnrollmentId("enr-2")),
          personId: personA,
          classGroupId: classA,
        }),
        enrollment({
          id: valueOf(parseEnrollmentId("enr-3")),
          personId: personA,
          classGroupId: classB,
        }),
        enrollment({
          id: valueOf(parseEnrollmentId("enr-4")),
          personId: personB,
          classGroupId: classA,
        }),
      ]),
    ).toEqual([]);
  });
});

describe("findAttendanceNumberConflicts", () => {
  it("detects duplicate attendance numbers only for overlapping active rows", () => {
    const issues = findAttendanceNumberConflicts([
      enrollment({
        id: valueOf(parseEnrollmentId("enr-1")),
        personId: personA,
        classGroupId: classA,
        attendanceNumber: "12",
      }),
      enrollment({
        id: valueOf(parseEnrollmentId("enr-2")),
        personId: personB,
        classGroupId: classA,
        attendanceNumber: "12",
        startDate: mid,
      }),
    ]);

    expect(issues.length).toBeGreaterThan(0);
  });

  it("allows null attendance numbers", () => {
    expect(
      findAttendanceNumberConflicts([
        enrollment({
          id: valueOf(parseEnrollmentId("enr-1")),
          personId: personA,
          classGroupId: classA,
          attendanceNumber: null,
        }),
        enrollment({
          id: valueOf(parseEnrollmentId("enr-2")),
          personId: personB,
          classGroupId: classA,
          attendanceNumber: null,
        }),
      ]),
    ).toEqual([]);
  });

  it("allows same attendance number in different classes, ended, or non-overlap", () => {
    expect(
      findAttendanceNumberConflicts([
        enrollment({
          id: valueOf(parseEnrollmentId("enr-1")),
          personId: personA,
          classGroupId: classA,
          attendanceNumber: "7",
          endDate: mid,
        }),
        enrollment({
          id: valueOf(parseEnrollmentId("enr-2")),
          personId: personB,
          classGroupId: classA,
          attendanceNumber: "7",
          startDate: next,
        }),
        enrollment({
          id: valueOf(parseEnrollmentId("enr-3")),
          personId: personA,
          classGroupId: classB,
          attendanceNumber: "7",
        }),
        enrollment({
          id: valueOf(parseEnrollmentId("enr-4")),
          personId: personB,
          classGroupId: classA,
          status: "ended",
          attendanceNumber: "7",
          endDate: end,
        }),
      ]),
    ).toEqual([]);
  });

  it("does not compare an enrollment against itself", () => {
    const single = enrollment({
      id: valueOf(parseEnrollmentId("enr-1")),
      personId: personA,
      classGroupId: classA,
      attendanceNumber: "1",
    });

    expect(findAttendanceNumberConflicts([single])).toEqual([]);
  });
});

describe("assertSchoolWorkspaceKind", () => {
  const school: School = {
    id: schoolId,
    workspaceId,
    name: "North School",
    createdAt: now,
    updatedAt: later,
  };

  it("accepts a school workspace with matching workspaceId", () => {
    const workspace: Workspace = {
      id: workspaceId,
      kind: "school",
      name: "North",
      createdAt: now,
      updatedAt: later,
    };

    expect(assertSchoolWorkspaceKind(workspace, school)).toEqual({
      ok: true,
      value: true,
    });
  });

  it("rejects school records on non-school workspaces", () => {
    const workspace: Workspace = {
      id: workspaceId,
      kind: "personal",
      name: "Personal",
      createdAt: now,
      updatedAt: later,
    };

    const result = assertSchoolWorkspaceKind(workspace, school);
    expect(result).toMatchObject({ok: false});
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it("rejects school records whose workspaceId does not match", () => {
    const workspace: Workspace = {
      id: otherWorkspaceId,
      kind: "school",
      name: "Other",
      createdAt: now,
      updatedAt: later,
    };

    const result = assertSchoolWorkspaceKind(workspace, school);
    expect(result).toMatchObject({ok: false});
    if (!result.ok) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });
});
