import {describe, expect, expectTypeOf, it} from "vitest";
import {
  parseClassGroupId,
  parseRoleAssignmentId,
  parseUserAccountId,
  parseUtcDateTime,
  parseWorkspaceId,
} from "./ids.js";
import type {
  AccessScope,
  Enrollment,
  RoleAssignment,
  StaffAssignment,
} from "./models.js";
import {
  capabilitiesForRole,
  evaluateAccess,
  parseCapability,
  type Capability,
} from "./access.js";

function valueOf<T>(result: {ok: true; value: T} | {ok: false}): T {
  if (!result.ok) {
    throw new Error("invalid test fixture");
  }
  return result.value;
}

const accountId = valueOf(parseUserAccountId("account-1"));
const otherAccountId = valueOf(parseUserAccountId("account-2"));
const assignmentId = valueOf(parseRoleAssignmentId("assignment-1"));
const workspaceId = valueOf(parseWorkspaceId("workspace-1"));
const otherWorkspaceId = valueOf(parseWorkspaceId("workspace-2"));
const classGroupId = valueOf(parseClassGroupId("class-1"));
const now = valueOf(parseUtcDateTime("2026-07-17T12:00:00.000Z"));
const later = valueOf(parseUtcDateTime("2026-07-18T12:00:00.000Z"));

const ALL_CAPABILITIES = [
  "system.settings.read",
  "system.settings.write",
  "system.secrets.read",
  "system.secrets.write",
  "system.limits.read",
  "system.limits.write",
  "system.owner.transfer",
  "workspace.settings.read",
  "workspace.settings.write",
  "workspace.members.read",
  "workspace.members.manage",
  "workspace.invites.manage",
  "workspace.projects.create",
  "school.settings.read",
  "school.settings.write",
  "school.roster.read",
  "school.roster.manage",
  "school.roster_claim.issue",
  "school.permissions.manage",
  "class.read",
  "class.roster.read",
  "class.roster.manage",
  "class.assignment.manage",
  "class.permissions.manage",
  "project.read",
  "project.edit",
  "project.comment",
  "project.members.manage",
  "project.host.manage",
] as const satisfies readonly Capability[];

const SYSTEM = ALL_CAPABILITIES.filter((value) => value.startsWith("system."));
const WORKSPACE = ALL_CAPABILITIES.filter((value) =>
  value.startsWith("workspace."),
);
const SCHOOL = ALL_CAPABILITIES.filter((value) => value.startsWith("school."));
const CLASS = ALL_CAPABILITIES.filter((value) => value.startsWith("class."));
const PROJECT = ALL_CAPABILITIES.filter((value) =>
  value.startsWith("project."),
);

const ROLE_MATRIX: readonly [
  AccessScope["kind"],
  string,
  readonly Capability[],
][] = [
  ["system", "owner", SYSTEM],
  [
    "system",
    "operator",
    [
      "system.settings.read",
      "system.settings.write",
      "system.limits.read",
      "system.limits.write",
    ],
  ],
  ["workspace", "owner", WORKSPACE],
  ["workspace", "admin", WORKSPACE],
  [
    "workspace",
    "member",
    [
      "workspace.settings.read",
      "workspace.members.read",
      "workspace.projects.create",
    ],
  ],
  ["workspace", "guest", ["workspace.settings.read"]],
  ["school", "school_admin", SCHOOL],
  [
    "school",
    "staff",
    [
      "school.settings.read",
      "school.roster.read",
      "school.roster.manage",
      "school.roster_claim.issue",
    ],
  ],
  [
    "school",
    "student",
    ["school.settings.read", "school.roster.read"],
  ],
  ["class", "teacher", CLASS],
  [
    "class",
    "assistant",
    [
      "class.read",
      "class.roster.read",
      "class.roster.manage",
      "class.assignment.manage",
    ],
  ],
  ["class", "student", ["class.read", "class.roster.read"]],
  ["project", "owner", PROJECT],
  [
    "project",
    "host",
    [
      "project.read",
      "project.edit",
      "project.comment",
      "project.members.manage",
      "project.host.manage",
    ],
  ],
  ["project", "editor", ["project.read", "project.edit", "project.comment"]],
  ["project", "commenter", ["project.read", "project.comment"]],
  ["project", "viewer", ["project.read"]],
];

describe("workspace-directory access", () => {
  it("parses exactly the closed 29-capability union", () => {
    expect(ALL_CAPABILITIES).toHaveLength(29);
    for (const capability of ALL_CAPABILITIES) {
      expect(parseCapability(capability)).toEqual({
        ok: true,
        value: capability,
      });
    }
    expect(parseCapability("school.magic")).toMatchObject({ok: false});
  });

  it.each(ROLE_MATRIX)(
    "maps %s/%s to its exact capability template",
    (scopeKind, role, expected) => {
      expect([...capabilitiesForRole(scopeKind, role)]).toEqual(expected);
      const expectedSet = new Set(expected);
      for (const capability of ALL_CAPABILITIES) {
        expect(capabilitiesForRole(scopeKind, role).has(capability)).toBe(
          expectedSet.has(capability),
        );
      }
    },
  );

  it("returns no capabilities for unknown or cross-scope roles", () => {
    expect([...capabilitiesForRole("system", "admin")]).toEqual([]);
    expect([...capabilitiesForRole("school", "teacher")]).toEqual([]);
    expect([...capabilitiesForRole("system", "__proto__")]).toEqual([]);
  });

  it("denies empty, ended, wrong-account, and wrong-scope assignments", () => {
    const scope = {kind: "workspace" as const, workspaceId};
    const active: RoleAssignment = {
      id: assignmentId,
      accountId,
      scope,
      role: "member",
      status: "active",
      startedAt: now,
      endedAt: null,
    };
    const request = {
      accountId,
      scope,
      capability: "workspace.projects.create" as const,
      now,
    };

    expect(evaluateAccess({...request, assignments: []})).toBe(false);
    expect(
      evaluateAccess({
        ...request,
        assignments: [{...active, status: "ended", endedAt: now}],
      }),
    ).toBe(false);
    expect(
      evaluateAccess({
        ...request,
        assignments: [{...active, accountId: otherAccountId}],
      }),
    ).toBe(false);
    expect(
      evaluateAccess({
        ...request,
        assignments: [
          {
            ...active,
            scope: {kind: "workspace", workspaceId: otherWorkspaceId},
          },
        ],
      }),
    ).toBe(false);
    expect(
      evaluateAccess({
        ...request,
        assignments: [{...active, endedAt: later}],
      }),
    ).toBe(false);
  });

  it("grants only when an active exact-scope account role contains the capability", () => {
    const assignment: RoleAssignment = {
      id: assignmentId,
      accountId,
      scope: {kind: "class", classGroupId},
      role: "assistant",
      status: "active",
      startedAt: now,
      endedAt: null,
    };

    expect(
      evaluateAccess({
        assignments: [assignment],
        accountId,
        scope: assignment.scope,
        capability: "class.assignment.manage",
        now,
      }),
    ).toBe(true);
    expect(
      evaluateAccess({
        assignments: [assignment],
        accountId,
        scope: assignment.scope,
        capability: "class.permissions.manage",
        now,
      }),
    ).toBe(false);
  });

  it("keeps an explicit project host grant project-only", () => {
    const assignment: RoleAssignment = {
      id: assignmentId,
      accountId,
      scope: {kind: "project", projectId: "project-1"},
      role: "host",
      status: "active",
      startedAt: now,
      endedAt: null,
    };

    for (const capability of PROJECT) {
      expect(
        evaluateAccess({
          assignments: [assignment],
          accountId,
          scope: assignment.scope,
          capability,
          now,
        }),
      ).toBe(true);
    }
    expect(
      evaluateAccess({
        assignments: [assignment],
        accountId,
        scope: assignment.scope,
        capability: "system.secrets.read",
        now,
      }),
    ).toBe(false);
    expect(
      evaluateAccess({
        assignments: [assignment],
        accountId,
        scope: assignment.scope,
        capability: "school.roster.manage",
        now,
      }),
    ).toBe(false);
  });

  it("accepts RoleAssignment values only, not enrollment or staff facts", () => {
    type EvaluateInput = Parameters<typeof evaluateAccess>[0];
    expectTypeOf<EvaluateInput["assignments"]>().toEqualTypeOf<
      readonly RoleAssignment[]
    >();
    expectTypeOf<Enrollment>().not.toMatchTypeOf<RoleAssignment>();
    expectTypeOf<StaffAssignment>().not.toMatchTypeOf<RoleAssignment>();
  });
});
