import type {MigrationContext} from "../types.js";
import {SchemaMigrationError} from "../types.js";
import {
  assertCanonicalUtc,
  laterCanonicalUtc,
  legacyPersonAccountLinkId,
  legacyPersonDisplayName,
  legacyPersonId,
  legacyProjectRoleAssignmentId,
  legacyWorkspaceMembershipId,
  legacyWorkspaceRoleAssignmentId,
} from "./identity.js";
import type {
  LegacyBackfillSource,
  LegacyMembershipRow,
  LegacyProjectRow,
} from "./source.js";
import {validateLegacyBackfillSource} from "./validate.js";

export interface BackfillWorkspaceRow {
  readonly id: string;
  readonly kind: "casual";
  readonly name: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface BackfillUserAccountRow {
  readonly id: string;
  readonly display_name: string | null;
  readonly email: string | null;
  readonly status: "active" | "disabled";
  readonly created_at: string;
  readonly updated_at: string;
}

export interface BackfillPersonRow {
  readonly id: string;
  readonly display_name: string;
  readonly status: "active" | "disabled";
  readonly created_at: string;
  readonly updated_at: string;
}

export interface BackfillPersonAccountLinkRow {
  readonly id: string;
  readonly person_id: string;
  readonly account_id: string;
  readonly status: "active";
  readonly linked_at: string;
  readonly unlinked_at: null;
}

export interface BackfillWorkspaceMembershipRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly account_id: string;
  readonly role: "admin" | "member";
  readonly status: "active" | "ended";
  readonly started_at: string;
  readonly ended_at: string | null;
}

export interface BackfillWorkspaceDirectoryRevisionRow {
  readonly workspace_id: string;
  readonly revision: 0;
  readonly updated_at: string;
}

export type BackfillProjectRole =
  | "owner"
  | "host"
  | "editor"
  | "commenter"
  | "viewer";

export interface BackfillRoleAssignmentRow {
  readonly id: string;
  readonly account_id: string;
  readonly scope_kind: "workspace" | "project";
  readonly workspace_id: string | null;
  readonly school_id: null;
  readonly class_group_id: null;
  readonly project_id: string | null;
  readonly role: "admin" | "member" | BackfillProjectRole;
  readonly status: "active" | "ended";
  readonly started_at: string;
  readonly ended_at: string | null;
}

export interface LegacyBackfillPlan {
  readonly workspaces: readonly BackfillWorkspaceRow[];
  readonly userAccounts: readonly BackfillUserAccountRow[];
  readonly people: readonly BackfillPersonRow[];
  readonly personAccountLinks: readonly BackfillPersonAccountLinkRow[];
  readonly workspaceMemberships: readonly BackfillWorkspaceMembershipRow[];
  readonly workspaceDirectoryRevisions:
    readonly BackfillWorkspaceDirectoryRevisionRow[];
  readonly roleAssignments: readonly BackfillRoleAssignmentRow[];
  readonly sessionIdsToRevoke: readonly string[];
}

function freezeRows<Row extends object>(rows: Row[]): readonly Readonly<Row>[] {
  return Object.freeze(rows.map(row => Object.freeze(row)));
}

function compareSqliteBinary(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sortBy<Row>(
  rows: readonly Row[],
  key: (row: Row) => string,
): Row[] {
  return [...rows].sort((left, right) => {
    const leftKey = key(left);
    const rightKey = key(right);
    return compareSqliteBinary(leftKey, rightKey);
  });
}

function sortByPair<Row>(
  rows: readonly Row[],
  first: (row: Row) => string,
  second: (row: Row) => string,
): Row[] {
  return [...rows].sort((left, right) => {
    const leftFirst = first(left);
    const rightFirst = first(right);
    const firstComparison = compareSqliteBinary(leftFirst, rightFirst);
    if (firstComparison !== 0) return firstComparison;
    const leftSecond = second(left);
    const rightSecond = second(right);
    return compareSqliteBinary(leftSecond, rightSecond);
  });
}

function activeState(
  organizationStatus: string,
  userStatus: string,
  appliedAt: string,
): {status: "active" | "ended"; ended_at: string | null} {
  return organizationStatus === "active" && userStatus === "active"
    ? {status: "active", ended_at: null}
    : {status: "ended", ended_at: appliedAt};
}

function validateAppliedAt(appliedAt: string): void {
  try {
    assertCanonicalUtc(appliedAt, "context.appliedAt");
  } catch (error) {
    throw new SchemaMigrationError(
      "SCHEMA_BACKFILL_INVALID",
      "Legacy backfill appliedAt must be canonical UTC",
      {cause: error},
    );
  }
}

export function computeLegacyBackfillPlan(
  source: LegacyBackfillSource,
  context: MigrationContext,
): LegacyBackfillPlan {
  validateLegacyBackfillSource(source);
  validateAppliedAt(context.appliedAt);

  const organizations = sortBy(source.organizations, row => row.id);
  const users = sortBy(source.users, row => row.id);
  const memberships = sortByPair(
    source.memberships,
    row => row.organization_id,
    row => row.user_id,
  );
  const projects = sortBy(source.projects, row => row.id);
  const projectMembers = sortByPair(
    source.projectMembers,
    row => row.project_id,
    row => row.user_id,
  );
  const sessions = sortBy(source.sessions, row => row.id_hash);
  const organizationById = new Map(
    organizations.map(row => [row.id, row] as const),
  );
  const userById = new Map(users.map(row => [row.id, row] as const));
  const projectById = new Map(projects.map(row => [row.id, row] as const));

  const workspaces = freezeRows(
    organizations.map(row => ({
      id: row.id,
      kind: "casual" as const,
      name: row.name.trim(),
      created_at: row.created_at,
      updated_at: row.created_at,
    })),
  );
  const userAccounts = freezeRows(
    users.map(row => ({
      id: row.id,
      display_name: row.display_name,
      email: row.email,
      status: row.status as "active" | "disabled",
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
  );
  const people = freezeRows(
    users.map(row => ({
      id: legacyPersonId(row.id),
      display_name: legacyPersonDisplayName(row.display_name, row.email),
      status: row.status as "active" | "disabled",
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
  );
  const personAccountLinks = freezeRows(
    users.map(row => ({
      id: legacyPersonAccountLinkId(row.id),
      person_id: legacyPersonId(row.id),
      account_id: row.id,
      status: "active" as const,
      linked_at: row.created_at,
      unlinked_at: null,
    })),
  );
  const workspaceMemberships = freezeRows(
    memberships.map(row => {
      const organization = organizationById.get(row.organization_id)!;
      const user = userById.get(row.user_id)!;
      const state = activeState(
        organization.status,
        user.status,
        context.appliedAt,
      );
      return {
        id: legacyWorkspaceMembershipId(row.organization_id, row.user_id),
        workspace_id: row.organization_id,
        account_id: row.user_id,
        role: row.role as "admin" | "member",
        ...state,
        started_at: laterCanonicalUtc(
          organization.created_at,
          user.created_at,
        ),
      };
    }),
  );
  const workspaceDirectoryRevisions = freezeRows(
    organizations.map(row => ({
      workspace_id: row.id,
      revision: 0 as const,
      updated_at: row.created_at,
    })),
  );

  const workspaceRoleAssignments = memberships.map(row =>
    workspaceRoleAssignment(
      row,
      organizationById.get(row.organization_id)!,
      userById.get(row.user_id)!,
      context.appliedAt,
    ),
  );
  const ownerRoleAssignments = projects.map(row =>
    projectRoleAssignment(
      row,
      row.owner_user_id,
      "owner",
      organizationById.get(row.organization_id)!.status,
      userById.get(row.owner_user_id)!,
      context.appliedAt,
    ),
  );
  const memberRoleAssignments = projectMembers
    .filter(row => {
      const project = projectById.get(row.project_id)!;
      return row.user_id !== project.owner_user_id;
    })
    .map(row => {
      const project = projectById.get(row.project_id)!;
      return projectRoleAssignment(
        project,
        row.user_id,
        row.role as BackfillProjectRole,
        organizationById.get(project.organization_id)!.status,
        userById.get(row.user_id)!,
        context.appliedAt,
      );
    });

  return Object.freeze({
    workspaces,
    userAccounts,
    people,
    personAccountLinks,
    workspaceMemberships,
    workspaceDirectoryRevisions,
    roleAssignments: freezeRows([
      ...workspaceRoleAssignments,
      ...ownerRoleAssignments,
      ...memberRoleAssignments,
    ]),
    sessionIdsToRevoke: Object.freeze(
      sessions.filter(row => row.revoked_at === null).map(row => row.id_hash),
    ),
  });
}

function workspaceRoleAssignment(
  membership: LegacyMembershipRow,
  organization: {readonly status: string; readonly created_at: string},
  user: {
    readonly id: string;
    readonly status: string;
    readonly created_at: string;
  },
  appliedAt: string,
): BackfillRoleAssignmentRow {
  return {
    id: legacyWorkspaceRoleAssignmentId(
      membership.organization_id,
      membership.user_id,
      membership.role as "admin" | "member",
    ),
    account_id: membership.user_id,
    scope_kind: "workspace",
    workspace_id: membership.organization_id,
    school_id: null,
    class_group_id: null,
    project_id: null,
    role: membership.role as "admin" | "member",
    ...activeState(organization.status, user.status, appliedAt),
    started_at: laterCanonicalUtc(organization.created_at, user.created_at),
  };
}

function projectRoleAssignment(
  project: LegacyProjectRow,
  userId: string,
  role: BackfillProjectRole,
  organizationStatus: string,
  user: {readonly status: string; readonly created_at: string},
  appliedAt: string,
): BackfillRoleAssignmentRow {
  return {
    id: legacyProjectRoleAssignmentId(project.id, userId, role),
    account_id: userId,
    scope_kind: "project",
    workspace_id: null,
    school_id: null,
    class_group_id: null,
    project_id: project.id,
    role,
    ...activeState(organizationStatus, user.status, appliedAt),
    started_at: laterCanonicalUtc(project.created_at, user.created_at),
  };
}
