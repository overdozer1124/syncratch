import type Database from "better-sqlite3";
import {
  DirectoryError,
  validatePerson,
  validatePersonAccountLink,
  validateRoleAssignment,
  validateUserAccount,
  validateWorkspace,
  validateWorkspaceMembership,
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
    createWorkspace() {
      throw new DirectoryError("DIRECTORY_INVALID", "write not implemented");
    },
    createPerson() {
      throw new DirectoryError("DIRECTORY_INVALID", "write not implemented");
    },
    updatePerson() {
      throw new DirectoryError("DIRECTORY_INVALID", "write not implemented");
    },
    linkPersonAccount() {
      throw new DirectoryError("DIRECTORY_INVALID", "write not implemented");
    },
    unlinkPersonAccount() {
      throw new DirectoryError("DIRECTORY_INVALID", "write not implemented");
    },
    createMembership() {
      throw new DirectoryError("DIRECTORY_INVALID", "write not implemented");
    },
    endMembership() {
      throw new DirectoryError("DIRECTORY_INVALID", "write not implemented");
    },
    grantWorkspaceRole() {
      throw new DirectoryError("DIRECTORY_INVALID", "write not implemented");
    },
    endWorkspaceRole() {
      throw new DirectoryError("DIRECTORY_INVALID", "write not implemented");
    },
  };

  return {
    withTransaction(fn) {
      return db.transaction(() => fn(tx))();
    },
  };
}
