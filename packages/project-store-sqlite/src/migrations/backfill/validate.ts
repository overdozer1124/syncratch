import {SchemaMigrationError} from "../types.js";
import {
  assertCanonicalUtc,
  legacyPersonAccountLinkId,
  legacyPersonId,
  legacyProjectRoleAssignmentId,
  legacyWorkspaceMembershipId,
  legacyWorkspaceRoleAssignmentId,
} from "./identity.js";
import {
  LEGACY_BACKFILL_TARGET_TABLES,
  type LegacyBackfillSource,
} from "./source.js";

const ORGANIZATION_STATUSES = new Set(["active", "suspended"]);
const USER_STATUSES = new Set(["active", "disabled"]);
const MEMBERSHIP_ROLES = new Set(["admin", "member"]);
const PROJECT_ROLES = new Set([
  "owner",
  "host",
  "editor",
  "commenter",
  "viewer",
]);

function invalid(message: string, cause?: unknown): never {
  throw new SchemaMigrationError("SCHEMA_BACKFILL_INVALID", message, {
    cause,
  });
}

function requireId(value: string, field: string): void {
  if (value.trim().length === 0) invalid(`${field} must not be blank`);
}

function requireCanonical(
  value: string | null,
  field: string,
): void {
  if (value === null) return;
  try {
    assertCanonicalUtc(value, field);
  } catch (error) {
    invalid(`Invalid legacy timestamp ${field}`, error);
  }
}

function requireUnique(
  seen: Set<string>,
  value: string,
  description: string,
): void {
  if (seen.has(value)) {
    invalid(`Deterministic target conflict for ${description}: ${value}`);
  }
  seen.add(value);
}

function pairKey(left: string, right: string): string {
  return JSON.stringify([left, right]);
}

export function validateLegacyBackfillSource(
  source: LegacyBackfillSource,
): void {
  for (const table of LEGACY_BACKFILL_TARGET_TABLES) {
    if (source.targetRowCounts[table] !== 0) {
      invalid(`Target table ${table} must be empty before legacy backfill`);
    }
  }

  const organizations = new Map(
    source.organizations.map(row => [row.id, row]),
  );
  const users = new Map(source.users.map(row => [row.id, row]));
  const membershipKeys = new Set(
    source.memberships.map(row => pairKey(row.organization_id, row.user_id)),
  );

  const organizationIds = new Set<string>();
  for (const row of source.organizations) {
    requireId(row.id, "organizations.id");
    requireUnique(organizationIds, row.id, "workspace id");
    if (row.name.trim().length === 0) {
      invalid(`Organization ${row.id} has a blank name`);
    }
    if (!ORGANIZATION_STATUSES.has(row.status)) {
      invalid(`Organization ${row.id} has unsupported status ${row.status}`);
    }
    requireCanonical(row.created_at, `organizations(${row.id}).created_at`);
  }

  const userIds = new Set<string>();
  const personIds = new Set<string>();
  const linkIds = new Set<string>();
  for (const row of source.users) {
    requireId(row.id, "users.id");
    requireId(row.primary_organization_id, "users.primary_organization_id");
    requireUnique(userIds, row.id, "account id");
    requireUnique(personIds, legacyPersonId(row.id), "person id");
    requireUnique(
      linkIds,
      legacyPersonAccountLinkId(row.id),
      "person/account link id",
    );
    if (!USER_STATUSES.has(row.status)) {
      invalid(`User ${row.id} has unsupported status ${row.status}`);
    }
    if (!organizations.has(row.primary_organization_id)) {
      invalid(`User ${row.id} references a missing primary organization`);
    }
    if (
      !membershipKeys.has(pairKey(row.primary_organization_id, row.id))
    ) {
      invalid(`User ${row.id} lacks its primary organization membership`);
    }
    requireCanonical(row.created_at, `users(${row.id}).created_at`);
    requireCanonical(row.updated_at, `users(${row.id}).updated_at`);
  }

  const workspaceMembershipIds = new Set<string>();
  const roleAssignmentIds = new Set<string>();
  const sourceMembershipKeys = new Set<string>();
  for (const row of source.memberships) {
    requireId(row.organization_id, "organization_memberships.organization_id");
    requireId(row.user_id, "organization_memberships.user_id");
    if (!MEMBERSHIP_ROLES.has(row.role)) {
      invalid(
        `Membership ${row.organization_id}/${row.user_id} has unsupported role ${row.role}`,
      );
    }
    if (!organizations.has(row.organization_id)) {
      invalid(`Membership references missing organization ${row.organization_id}`);
    }
    if (!users.has(row.user_id)) {
      invalid(`Membership references missing user ${row.user_id}`);
    }
    requireUnique(
      sourceMembershipKeys,
      pairKey(row.organization_id, row.user_id),
      "organization membership",
    );
    requireUnique(
      workspaceMembershipIds,
      legacyWorkspaceMembershipId(row.organization_id, row.user_id),
      "workspace membership id",
    );
    requireUnique(
      roleAssignmentIds,
      legacyWorkspaceRoleAssignmentId(
        row.organization_id,
        row.user_id,
        row.role as "admin" | "member",
      ),
      "role assignment id",
    );
  }

  const projectIds = new Set<string>();
  for (const row of source.projects) {
    requireId(row.id, "projects.id");
    requireId(row.organization_id, "projects.organization_id");
    requireId(row.owner_user_id, "projects.owner_user_id");
    requireUnique(projectIds, row.id, "project id");
    if (!organizations.has(row.organization_id)) {
      invalid(`Project ${row.id} references a missing organization`);
    }
    if (!users.has(row.owner_user_id)) {
      invalid(`Project ${row.id} references a missing owner`);
    }
    if (
      !membershipKeys.has(pairKey(row.organization_id, row.owner_user_id))
    ) {
      invalid(`Project ${row.id} owner is outside its organization`);
    }
    requireCanonical(row.created_at, `projects(${row.id}).created_at`);
    requireCanonical(row.updated_at, `projects(${row.id}).updated_at`);
    requireUnique(
      roleAssignmentIds,
      legacyProjectRoleAssignmentId(row.id, row.owner_user_id, "owner"),
      "role assignment id",
    );
  }

  const projects = new Map(source.projects.map(row => [row.id, row]));
  const projectMemberKeys = new Set<string>();
  for (const row of source.projectMembers) {
    requireId(row.project_id, "project_members.project_id");
    requireId(row.user_id, "project_members.user_id");
    if (!PROJECT_ROLES.has(row.role)) {
      invalid(
        `Project member ${row.project_id}/${row.user_id} has unsupported role ${row.role}`,
      );
    }
    const project = projects.get(row.project_id);
    if (!project) invalid(`Project member references missing project ${row.project_id}`);
    if (!users.has(row.user_id)) {
      invalid(`Project member references missing user ${row.user_id}`);
    }
    if (
      !membershipKeys.has(pairKey(project.organization_id, row.user_id))
    ) {
      invalid(
        `Project member ${row.project_id}/${row.user_id} is outside its organization`,
      );
    }
    requireUnique(
      projectMemberKeys,
      pairKey(row.project_id, row.user_id),
      "project member",
    );

    // The project owner is authoritative. Normalize its project_members row
    // away before checking deterministic assignment conflicts.
    if (row.user_id === project.owner_user_id) continue;
    requireUnique(
      roleAssignmentIds,
      legacyProjectRoleAssignmentId(
        row.project_id,
        row.user_id,
        row.role as "owner" | "host" | "editor" | "commenter" | "viewer",
      ),
      "role assignment id",
    );
  }

  const sessionIds = new Set<string>();
  for (const row of source.sessions) {
    requireId(row.id_hash, "sessions.id_hash");
    requireId(row.user_id, "sessions.user_id");
    requireId(row.organization_id, "sessions.organization_id");
    requireUnique(sessionIds, row.id_hash, "session id");
    if (
      !membershipKeys.has(pairKey(row.organization_id, row.user_id))
    ) {
      invalid(`Session ${row.id_hash} has inconsistent organization membership`);
    }
    requireCanonical(row.created_at, `sessions(${row.id_hash}).created_at`);
    requireCanonical(row.expires_at, `sessions(${row.id_hash}).expires_at`);
    requireCanonical(row.revoked_at, `sessions(${row.id_hash}).revoked_at`);
    requireCanonical(row.last_seen_at, `sessions(${row.id_hash}).last_seen_at`);
  }
}
