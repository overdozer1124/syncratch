import type {
  Person,
  PersonAccountLink,
  RoleAssignment,
  UserAccount,
  Workspace,
  WorkspaceMembership,
} from "./models.js";

export interface DirectoryRevisionState {
  revision: number;
  updatedAt: string; // UtcDateTime string
}

export interface WorkspaceDirectoryRepository {
  withTransaction<T>(fn: (tx: WorkspaceDirectoryRepositoryTx) => T): T;
}

export interface WorkspaceDirectoryRepositoryTx {
  getWorkspace(workspaceId: string): Workspace | null;
  listWorkspacesForAccount(accountId: string): Workspace[];
  getUserAccount(accountId: string): UserAccount | null;
  getPerson(personId: string): Person | null;
  getActivePersonAccountLinkByAccount(
    accountId: string,
  ): PersonAccountLink | null;
  getActivePersonAccountLinkByPerson(
    personId: string,
  ): PersonAccountLink | null;
  listMembershipsForWorkspace(
    workspaceId: string,
    options?: {includeEnded?: boolean},
  ): WorkspaceMembership[];
  listMembershipsForAccount(
    accountId: string,
    options?: {includeEnded?: boolean},
  ): WorkspaceMembership[];
  listWorkspaceRoleAssignments(
    workspaceId: string,
    options?: {includeEnded?: boolean},
  ): RoleAssignment[]; // only scope.kind === "workspace"
  getDirectoryRevision(workspaceId: string): DirectoryRevisionState | null;

  createWorkspace(input: {
    workspace: Workspace;
    initialRevision?: number;
  }): DirectoryRevisionState;

  createPerson(input: {
    workspaceId: string;
    expectedRevision: number;
    person: Person;
  }): {revision: number; person: Person};

  updatePerson(input: {
    workspaceId: string;
    expectedRevision: number;
    personId: string;
    patch: {displayName?: string; status?: Person["status"]};
    updatedAt: string;
  }): {revision: number; person: Person};

  linkPersonAccount(input: {
    workspaceId: string;
    expectedRevision: number;
    link: PersonAccountLink;
  }): {revision: number; link: PersonAccountLink};

  unlinkPersonAccount(input: {
    workspaceId: string;
    expectedRevision: number;
    linkId: string;
    unlinkedAt: string;
  }): {revision: number; link: PersonAccountLink};

  createMembership(input: {
    expectedRevision: number;
    membership: WorkspaceMembership;
  }): {revision: number; membership: WorkspaceMembership};

  endMembership(input: {
    expectedRevision: number;
    membershipId: string;
    endedAt: string;
  }): {revision: number; membership: WorkspaceMembership};

  grantWorkspaceRole(input: {
    expectedRevision: number;
    assignment: Extract<
      RoleAssignment,
      {scope: {kind: "workspace"}}
    >;
  }): {revision: number; assignment: RoleAssignment};

  endWorkspaceRole(input: {
    expectedRevision: number;
    assignmentId: string;
    endedAt: string;
  }): {revision: number; assignment: RoleAssignment};
}
