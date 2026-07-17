import type {UserAccountId, UtcDateTime} from "./ids.js";
import type {AccessScope, RoleAssignment} from "./models.js";
import {fail, issue, ok, type ValidationResult} from "./validation.js";

export type Capability =
  | "system.settings.read"
  | "system.settings.write"
  | "system.secrets.read"
  | "system.secrets.write"
  | "system.limits.read"
  | "system.limits.write"
  | "system.owner.transfer"
  | "workspace.settings.read"
  | "workspace.settings.write"
  | "workspace.members.read"
  | "workspace.members.manage"
  | "workspace.invites.manage"
  | "workspace.projects.create"
  | "school.settings.read"
  | "school.settings.write"
  | "school.roster.read"
  | "school.roster.manage"
  | "school.roster_claim.issue"
  | "school.permissions.manage"
  | "class.read"
  | "class.roster.read"
  | "class.roster.manage"
  | "class.assignment.manage"
  | "class.permissions.manage"
  | "project.read"
  | "project.edit"
  | "project.comment"
  | "project.members.manage"
  | "project.host.manage";

const SYSTEM_CAPABILITIES = [
  "system.settings.read",
  "system.settings.write",
  "system.secrets.read",
  "system.secrets.write",
  "system.limits.read",
  "system.limits.write",
  "system.owner.transfer",
] as const satisfies readonly Capability[];

const WORKSPACE_CAPABILITIES = [
  "workspace.settings.read",
  "workspace.settings.write",
  "workspace.members.read",
  "workspace.members.manage",
  "workspace.invites.manage",
  "workspace.projects.create",
] as const satisfies readonly Capability[];

const SCHOOL_CAPABILITIES = [
  "school.settings.read",
  "school.settings.write",
  "school.roster.read",
  "school.roster.manage",
  "school.roster_claim.issue",
  "school.permissions.manage",
] as const satisfies readonly Capability[];

const CLASS_CAPABILITIES = [
  "class.read",
  "class.roster.read",
  "class.roster.manage",
  "class.assignment.manage",
  "class.permissions.manage",
] as const satisfies readonly Capability[];

const PROJECT_CAPABILITIES = [
  "project.read",
  "project.edit",
  "project.comment",
  "project.members.manage",
  "project.host.manage",
] as const satisfies readonly Capability[];

const CAPABILITIES = new Set<Capability>([
  ...SYSTEM_CAPABILITIES,
  ...WORKSPACE_CAPABILITIES,
  ...SCHOOL_CAPABILITIES,
  ...CLASS_CAPABILITIES,
  ...PROJECT_CAPABILITIES,
]);

const ROLE_CAPABILITIES: Readonly<
  Record<
    AccessScope["kind"],
    Readonly<Record<string, readonly Capability[]>>
  >
> = {
  system: {
    owner: SYSTEM_CAPABILITIES,
    operator: [
      "system.settings.read",
      "system.settings.write",
      "system.limits.read",
      "system.limits.write",
    ],
  },
  workspace: {
    owner: WORKSPACE_CAPABILITIES,
    admin: WORKSPACE_CAPABILITIES,
    member: [
      "workspace.settings.read",
      "workspace.members.read",
      "workspace.projects.create",
    ],
    guest: ["workspace.settings.read"],
  },
  school: {
    school_admin: SCHOOL_CAPABILITIES,
    staff: [
      "school.settings.read",
      "school.roster.read",
      "school.roster.manage",
      "school.roster_claim.issue",
    ],
    student: ["school.settings.read", "school.roster.read"],
  },
  class: {
    teacher: CLASS_CAPABILITIES,
    assistant: [
      "class.read",
      "class.roster.read",
      "class.roster.manage",
      "class.assignment.manage",
    ],
    student: ["class.read", "class.roster.read"],
  },
  project: {
    owner: PROJECT_CAPABILITIES,
    host: PROJECT_CAPABILITIES,
    editor: ["project.read", "project.edit", "project.comment"],
    commenter: ["project.read", "project.comment"],
    viewer: ["project.read"],
  },
};

export function parseCapability(
  value: string,
): ValidationResult<Capability> {
  return CAPABILITIES.has(value as Capability)
    ? ok(value as Capability)
    : fail([
        issue(
          "invalid_capability",
          "Capability must be one of the closed capability values",
        ),
      ]);
}

export function capabilitiesForRole(
  scopeKind: AccessScope["kind"],
  role: string,
): ReadonlySet<Capability> {
  if (!Object.prototype.hasOwnProperty.call(ROLE_CAPABILITIES, scopeKind)) {
    return new Set();
  }
  const templates = ROLE_CAPABILITIES[scopeKind];
  const capabilities = Object.prototype.hasOwnProperty.call(templates, role)
    ? templates[role]
    : undefined;
  return capabilities ? new Set(capabilities) : new Set();
}

function scopesEqual(left: AccessScope, right: AccessScope): boolean {
  if (left.kind !== right.kind) {
    return false;
  }

  switch (left.kind) {
    case "system":
      return true;
    case "workspace":
      return (
        right.kind === "workspace" && left.workspaceId === right.workspaceId
      );
    case "school":
      return right.kind === "school" && left.schoolId === right.schoolId;
    case "class":
      return (
        right.kind === "class" && left.classGroupId === right.classGroupId
      );
    case "project":
      return right.kind === "project" && left.projectId === right.projectId;
  }
}

export function evaluateAccess(input: {
  assignments: readonly RoleAssignment[];
  accountId: UserAccountId;
  scope: AccessScope;
  capability: Capability;
  now: UtcDateTime;
}): boolean {
  return input.assignments.some(
    (assignment) =>
      assignment.status === "active" &&
      assignment.endedAt === null &&
      assignment.accountId === input.accountId &&
      scopesEqual(assignment.scope, input.scope) &&
      capabilitiesForRole(assignment.scope.kind, assignment.role).has(
        input.capability,
      ),
  );
}
