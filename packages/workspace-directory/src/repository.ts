import type {
  Enrollment,
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
  getEnrollment(workspaceId: string, enrollmentId: string): Enrollment | null;

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
    workspaceId: string;
    expectedRevision: number;
    membershipId: string;
    endedAt: string;
  }): {revision: number; membership: WorkspaceMembership};

  createEnrollment(input: {
    workspaceId: string;
    expectedRevision: number;
    updatedAt: string;
    enrollment: Enrollment;
  }): {revision: number; enrollment: Enrollment};

  updateEnrollment(input: {
    workspaceId: string;
    expectedRevision: number;
    updatedAt: string;
    enrollmentId: string;
    patch: {
      attendanceNumber?: string | null;
      startDate?: string;
    };
  }): {revision: number; enrollment: Enrollment};

  endEnrollment(input: {
    workspaceId: string;
    expectedRevision: number;
    updatedAt: string;
    enrollmentId: string;
    endDate: string;
  }): {revision: number; enrollment: Enrollment};

  grantWorkspaceRole(input: {
    expectedRevision: number;
    assignment: Extract<
      RoleAssignment,
      {scope: {kind: "workspace"}}
    >;
  }): {revision: number; assignment: RoleAssignment};

  endWorkspaceRole(input: {
    workspaceId: string;
    expectedRevision: number;
    assignmentId: string;
    endedAt: string;
  }): {revision: number; assignment: RoleAssignment};
}
