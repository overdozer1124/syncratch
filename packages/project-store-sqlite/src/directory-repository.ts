import type Database from "better-sqlite3";
import {
  assertCanEndWorkspaceOwnerMembership,
  DirectoryError,
  validatePerson,
  validatePersonAccountLink,
  validateRoleAssignment,
  validateUserAccount,
  validateWorkspace,
  validateWorkspaceMembership,
  type Enrollment,
  type Person,
  type PersonAccountLink,
  type RoleAssignment,
  type UserAccount,
  type Workspace,
  type WorkspaceDirectoryRepository,
  type WorkspaceDirectoryRepositoryTx,
  type WorkspaceMembership,
} from "@blocksync/workspace-directory";

function validated<T>(
  value: T,
  validate: (candidate: T) => {ok: true; value: T} | {
    ok: false;
    issues: readonly {message: string}[];
  },
): T {
  const result = validate(value);
  if (!result.ok) {
    throw new DirectoryError(
      "DIRECTORY_INVALID",
      result.issues.map(issue => issue.message).join("; "),
    );
  }
  return result.value;
}

interface WorkspaceRoleAssignmentRow {
  id: string;
  accountId: string;
  workspaceId: string;
  role: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
}

export function createSqliteWorkspaceDirectoryRepository(
  db: Database.Database,
): WorkspaceDirectoryRepository {
  const getWorkspace = db.prepare(`
    SELECT id, kind, name, created_at AS createdAt, updated_at AS updatedAt
    FROM workspaces WHERE id = ?
  `);
  const listWorkspacesForAccount = db.prepare(`
    SELECT w.id, w.kind, w.name, w.created_at AS createdAt, w.updated_at AS updatedAt
    FROM workspaces w
    INNER JOIN workspace_memberships m ON m.workspace_id = w.id
    WHERE m.account_id = ? AND m.status = 'active'
    ORDER BY w.id
  `);
  const getUserAccount = db.prepare(`
    SELECT id, display_name AS displayName, email, status,
           created_at AS createdAt, updated_at AS updatedAt
    FROM user_accounts WHERE id = ?
  `);
  const getPerson = db.prepare(`
    SELECT id, display_name AS displayName, status,
           created_at AS createdAt, updated_at AS updatedAt
    FROM people WHERE id = ?
  `);
  const getActiveLinkByAccount = db.prepare(`
    SELECT id, person_id AS personId, account_id AS accountId, status,
           linked_at AS linkedAt, unlinked_at AS unlinkedAt
    FROM person_account_links
    WHERE account_id = ? AND status = 'active'
  `);
  const getActiveLinkByPerson = db.prepare(`
    SELECT id, person_id AS personId, account_id AS accountId, status,
           linked_at AS linkedAt, unlinked_at AS unlinkedAt
    FROM person_account_links
    WHERE person_id = ? AND status = 'active'
  `);
  const listMembershipsForWorkspace = db.prepare(`
    SELECT id, workspace_id AS workspaceId, account_id AS accountId, role, status,
           started_at AS startedAt, ended_at AS endedAt
    FROM workspace_memberships
    WHERE workspace_id = ? AND (? OR status = 'active')
    ORDER BY started_at, id
  `);
  const listMembershipsForAccount = db.prepare(`
    SELECT id, workspace_id AS workspaceId, account_id AS accountId, role, status,
           started_at AS startedAt, ended_at AS endedAt
    FROM workspace_memberships
    WHERE account_id = ? AND (? OR status = 'active')
    ORDER BY started_at, id
  `);
  const listWorkspaceRoleAssignments = db.prepare(`
    SELECT id, account_id AS accountId, role, status,
           started_at AS startedAt, ended_at AS endedAt, workspace_id AS workspaceId
    FROM role_assignments
    WHERE scope_kind = 'workspace' AND workspace_id = ?
      AND (? OR status = 'active')
    ORDER BY started_at, id
  `);
  const getDirectoryRevision = db.prepare(`
    SELECT revision, updated_at AS updatedAt
    FROM workspace_directory_revisions
    WHERE workspace_id = ?
  `);
  const getMembershipById = db.prepare(`
    SELECT id, workspace_id AS workspaceId, account_id AS accountId, role, status,
           started_at AS startedAt, ended_at AS endedAt
    FROM workspace_memberships WHERE id = ?
  `);
  const getRoleAssignmentById = db.prepare(`
    SELECT id, account_id AS accountId, role, status,
           started_at AS startedAt, ended_at AS endedAt, workspace_id AS workspaceId
    FROM role_assignments WHERE id = ? AND scope_kind = 'workspace'
  `);
  const getPersonAccountLinkById = db.prepare(`
    SELECT id, person_id AS personId, account_id AS accountId, status,
           linked_at AS linkedAt, unlinked_at AS unlinkedAt
    FROM person_account_links WHERE id = ?
  `);

  const insertWorkspaceStmt = db.prepare(`
    INSERT INTO workspaces(id, kind, name, created_at, updated_at)
    VALUES (@id, @kind, @name, @createdAt, @updatedAt)
  `);
  const insertRevisionStmt = db.prepare(`
    INSERT INTO workspace_directory_revisions(workspace_id, revision, updated_at)
    VALUES (@workspaceId, @revision, @updatedAt)
  `);
  const bumpRevisionStmt = db.prepare(`
    UPDATE workspace_directory_revisions
    SET revision = revision + 1, updated_at = @updatedAt
    WHERE workspace_id = @workspaceId
  `);
  const insertPersonStmt = db.prepare(`
    INSERT INTO people(id, display_name, status, created_at, updated_at)
    VALUES (@id, @displayName, @status, @createdAt, @updatedAt)
  `);
  const updatePersonStmt = db.prepare(`
    UPDATE people SET display_name = @displayName, status = @status, updated_at = @updatedAt
    WHERE id = @id
  `);
  const insertLinkStmt = db.prepare(`
    INSERT INTO person_account_links(id, person_id, account_id, status, linked_at, unlinked_at)
    VALUES (@id, @personId, @accountId, @status, @linkedAt, @unlinkedAt)
  `);
  const updateLinkStmt = db.prepare(`
    UPDATE person_account_links SET status = 'unlinked', unlinked_at = @unlinkedAt
    WHERE id = @id
  `);
  const insertMembershipStmt = db.prepare(`
    INSERT INTO workspace_memberships(id, workspace_id, account_id, role, status, started_at, ended_at)
    VALUES (@id, @workspaceId, @accountId, @role, @status, @startedAt, @endedAt)
  `);
  const endMembershipStmt = db.prepare(`
    UPDATE workspace_memberships SET status = 'ended', ended_at = @endedAt
    WHERE id = @id
  `);
  const countActiveOwnersStmt = db.prepare(`
    SELECT COUNT(*) AS count
    FROM workspace_memberships
    WHERE workspace_id = ? AND status = 'active' AND role = 'owner'
  `);
  const insertRoleAssignmentStmt = db.prepare(`
    INSERT INTO role_assignments(
      id, account_id, scope_kind, workspace_id, role, status, started_at, ended_at
    ) VALUES (@id, @accountId, 'workspace', @workspaceId, @role, @status, @startedAt, @endedAt)
  `);
  const endRoleAssignmentStmt = db.prepare(`
    UPDATE role_assignments SET status = 'ended', ended_at = @endedAt
    WHERE id = @id
  `);

  function mapSqliteConstraint(error: unknown): DirectoryError | null {
    if (
      typeof error !== "object" ||
      error === null ||
      typeof (error as {code?: unknown}).code !== "string"
    ) {
      return null;
    }
    const code = (error as {code: string}).code;
    if (!code.startsWith("SQLITE_CONSTRAINT")) {
      return null;
    }
    const message =
      error instanceof Error ? error.message : "directory constraint violated";
    switch (code) {
      case "SQLITE_CONSTRAINT_UNIQUE":
      case "SQLITE_CONSTRAINT_PRIMARYKEY":
        return new DirectoryError("DIRECTORY_CONFLICT", message);
      case "SQLITE_CONSTRAINT_FOREIGNKEY":
        return new DirectoryError("DIRECTORY_NOT_FOUND", message);
      default:
        return new DirectoryError("DIRECTORY_INVALID", message);
    }
  }

  function runMappedConstraint<T>(fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      const mapped = mapSqliteConstraint(error);
      if (mapped) {
        throw mapped;
      }
      throw error;
    }
  }

  function assertAndBumpRevision(
    workspaceId: string,
    expectedRevision: number,
    updatedAt: string,
  ): number {
    const row = getDirectoryRevision.get(workspaceId) as
      | {revision: number}
      | undefined;
    if (!row) {
      throw new DirectoryError(
        "DIRECTORY_INVALID",
        `missing directory revision for workspace ${workspaceId}`,
      );
    }
    if (row.revision !== expectedRevision) {
      throw new DirectoryError(
        "DIRECTORY_REVISION_CONFLICT",
        `expected revision ${expectedRevision}, found ${row.revision}`,
      );
    }
    bumpRevisionStmt.run({workspaceId, updatedAt});
    return expectedRevision + 1;
  }

  const tx: WorkspaceDirectoryRepositoryTx = {
    getWorkspace(workspaceId) {
      const row = getWorkspace.get(workspaceId) as Workspace | undefined;
      return row === undefined ? null : validated(row, validateWorkspace);
    },
    listWorkspacesForAccount(accountId) {
      return (listWorkspacesForAccount.all(accountId) as Workspace[]).map(row =>
        validated(row, validateWorkspace),
      );
    },
    getUserAccount(accountId) {
      const row = getUserAccount.get(accountId) as UserAccount | undefined;
      return row === undefined ? null : validated(row, validateUserAccount);
    },
    getPerson(personId) {
      const row = getPerson.get(personId) as Person | undefined;
      return row === undefined ? null : validated(row, validatePerson);
    },
    getActivePersonAccountLinkByAccount(accountId) {
      const row = getActiveLinkByAccount.get(accountId) as
        | PersonAccountLink
        | undefined;
      return row === undefined
        ? null
        : validated(row, validatePersonAccountLink);
    },
    getActivePersonAccountLinkByPerson(personId) {
      const row = getActiveLinkByPerson.get(personId) as
        | PersonAccountLink
        | undefined;
      return row === undefined
        ? null
        : validated(row, validatePersonAccountLink);
    },
    listMembershipsForWorkspace(workspaceId, options) {
      return (
        listMembershipsForWorkspace.all(
          workspaceId,
          options?.includeEnded === true ? 1 : 0,
        ) as WorkspaceMembership[]
      ).map(row => validated(row, validateWorkspaceMembership));
    },
    listMembershipsForAccount(accountId, options) {
      return (
        listMembershipsForAccount.all(
          accountId,
          options?.includeEnded === true ? 1 : 0,
        ) as WorkspaceMembership[]
      ).map(row => validated(row, validateWorkspaceMembership));
    },
    listWorkspaceRoleAssignments(workspaceId, options) {
      return (
        listWorkspaceRoleAssignments.all(
          workspaceId,
          options?.includeEnded === true ? 1 : 0,
        ) as WorkspaceRoleAssignmentRow[]
      ).map(row => {
        const {workspaceId, ...assignment} = row;
        return validated(
          {
            ...assignment,
            scope: {kind: "workspace", workspaceId},
          } as RoleAssignment,
          validateRoleAssignment,
        );
      });
    },
    getDirectoryRevision(workspaceId) {
      const row = getDirectoryRevision.get(workspaceId) as
        | {revision: number; updatedAt: string}
        | undefined;
      return row ?? null;
    },
    getEnrollment(_enrollmentId: string): Enrollment | null {
      return null;
    },
    createWorkspace({workspace, initialRevision}) {
      const validWorkspace = validated(workspace, validateWorkspace);
      const revision = initialRevision ?? 0;
      if (!Number.isSafeInteger(revision) || revision < 0) {
        throw new DirectoryError(
          "DIRECTORY_INVALID",
          "initialRevision must be a non-negative safe integer",
        );
      }
      runMappedConstraint(() => {
        insertWorkspaceStmt.run(validWorkspace);
        insertRevisionStmt.run({
          workspaceId: validWorkspace.id,
          revision,
          updatedAt: validWorkspace.updatedAt,
        });
      });
      return {revision, updatedAt: validWorkspace.updatedAt};
    },
    createPerson({workspaceId, expectedRevision, person}) {
      const validPerson = validated(person, validatePerson);
      const revision = assertAndBumpRevision(
        workspaceId,
        expectedRevision,
        validPerson.updatedAt,
      );
      runMappedConstraint(() => insertPersonStmt.run(validPerson));
      return {revision, person: validPerson};
    },
    updatePerson({workspaceId, expectedRevision, personId, patch, updatedAt}) {
      const existing = getPerson.get(personId) as Person | undefined;
      if (existing === undefined) {
        throw new DirectoryError(
          "DIRECTORY_NOT_FOUND",
          `person ${personId} not found`,
        );
      }
      const merged = validated(
        {
          ...existing,
          displayName: patch.displayName ?? existing.displayName,
          status: patch.status ?? existing.status,
          updatedAt: updatedAt as Person["updatedAt"],
        },
        validatePerson,
      );
      const revision = assertAndBumpRevision(
        workspaceId,
        expectedRevision,
        updatedAt,
      );
      runMappedConstraint(() => updatePersonStmt.run(merged));
      return {revision, person: merged};
    },
    linkPersonAccount({workspaceId, expectedRevision, link}) {
      const validLink = validated(link, validatePersonAccountLink);
      const revision = assertAndBumpRevision(
        workspaceId,
        expectedRevision,
        validLink.linkedAt,
      );
      runMappedConstraint(() => insertLinkStmt.run(validLink));
      return {revision, link: validLink};
    },
    unlinkPersonAccount({workspaceId, expectedRevision, linkId, unlinkedAt}) {
      const existing = getPersonAccountLinkById.get(linkId) as
        | PersonAccountLink
        | undefined;
      if (existing === undefined) {
        throw new DirectoryError(
          "DIRECTORY_NOT_FOUND",
          `person-account link ${linkId} not found`,
        );
      }
      const updated = validated(
        {
          ...existing,
          status: "unlinked" as const,
          unlinkedAt: unlinkedAt as PersonAccountLink["unlinkedAt"],
        },
        validatePersonAccountLink,
      );
      const revision = assertAndBumpRevision(
        workspaceId,
        expectedRevision,
        unlinkedAt,
      );
      runMappedConstraint(() => updateLinkStmt.run({id: linkId, unlinkedAt}));
      return {revision, link: updated};
    },
    createMembership({expectedRevision, membership}) {
      const validMembership = validated(
        membership,
        validateWorkspaceMembership,
      );
      const revision = assertAndBumpRevision(
        validMembership.workspaceId,
        expectedRevision,
        validMembership.startedAt,
      );
      runMappedConstraint(() => insertMembershipStmt.run(validMembership));
      return {revision, membership: validMembership};
    },
    endMembership({workspaceId, expectedRevision, membershipId, endedAt}) {
      const existing = getMembershipById.get(membershipId) as
        | WorkspaceMembership
        | undefined;
      if (existing === undefined || existing.workspaceId !== workspaceId) {
        throw new DirectoryError(
          "DIRECTORY_NOT_FOUND",
          `membership ${membershipId} not found in workspace ${workspaceId}`,
        );
      }
      const activeOwnerCountInWorkspace = (
        countActiveOwnersStmt.get(workspaceId) as {count: number}
      ).count;
      assertCanEndWorkspaceOwnerMembership({
        membership: existing,
        activeOwnerCountInWorkspace,
      });
      const updated = validated(
        {
          ...existing,
          status: "ended" as const,
          endedAt: endedAt as WorkspaceMembership["endedAt"],
        },
        validateWorkspaceMembership,
      );
      const revision = assertAndBumpRevision(
        workspaceId,
        expectedRevision,
        endedAt,
      );
      runMappedConstraint(() => endMembershipStmt.run({id: membershipId, endedAt}));
      return {revision, membership: updated};
    },
    createEnrollment(_input) {
      throw new DirectoryError(
        "DIRECTORY_INVALID",
        "enrollment write not implemented",
      );
    },
    grantWorkspaceRole({expectedRevision, assignment}) {
      const validAssignment = validated(
        assignment as RoleAssignment,
        validateRoleAssignment,
      );
      const workspaceId = assignment.scope.workspaceId;
      const revision = assertAndBumpRevision(
        workspaceId,
        expectedRevision,
        assignment.startedAt,
      );
      runMappedConstraint(() =>
        insertRoleAssignmentStmt.run({
          id: assignment.id,
          accountId: assignment.accountId,
          workspaceId,
          role: assignment.role,
          status: assignment.status,
          startedAt: assignment.startedAt,
          endedAt: assignment.endedAt,
        }),
      );
      return {revision, assignment: validAssignment};
    },
    endWorkspaceRole({workspaceId, expectedRevision, assignmentId, endedAt}) {
      const existing = getRoleAssignmentById.get(assignmentId) as
        | WorkspaceRoleAssignmentRow
        | undefined;
      if (existing === undefined || existing.workspaceId !== workspaceId) {
        throw new DirectoryError(
          "DIRECTORY_NOT_FOUND",
          `workspace role assignment ${assignmentId} not found in workspace ${workspaceId}`,
        );
      }
      const {workspaceId: assignmentWorkspaceId, ...rest} = existing;
      const updated = validated(
        {
          ...rest,
          status: "ended" as const,
          endedAt: endedAt as RoleAssignment["endedAt"],
          scope: {kind: "workspace" as const, workspaceId: assignmentWorkspaceId},
        } as RoleAssignment,
        validateRoleAssignment,
      );
      const revision = assertAndBumpRevision(
        workspaceId,
        expectedRevision,
        endedAt,
      );
      runMappedConstraint(() =>
        endRoleAssignmentStmt.run({id: assignmentId, endedAt}),
      );
      return {revision, assignment: updated};
    },
  };

  return {
    withTransaction(fn) {
      return db.transaction(() => fn(tx))();
    },
  };
}
