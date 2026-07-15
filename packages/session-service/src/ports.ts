/**
 * Auth persistence port. Implemented by @blocksync/project-store-sqlite.
 * This package must not depend on SQLite.
 */

export interface SessionRow {
  idHash: string;
  userId: string;
  organizationId: string;
  csrfHash: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastSeenAt: string | null;
}

export interface AuthRepository {
  withTransaction<T>(fn: (tx: AuthRepositoryTx) => T): T;
}

export interface AuthRepositoryTx {
  findOrgIdByHostedDomain(hd: string): string | null;
  ensureOrgForHostedDomain(hd: string, name: string): string;
  findExternalIdentity(
    provider: "google",
    subject: string,
  ): { userId: string; organizationId: string } | null;
  createUser(args: {
    userId: string;
    primaryOrganizationId: string;
    email: string | null;
    displayName?: string | null;
    now: string;
  }): void;
  updateUserEmail(userId: string, email: string | null): void;
  ensureMembership(
    organizationId: string,
    userId: string,
    role: "member" | "admin",
  ): void;
  insertExternalIdentity(args: {
    provider: "google";
    subject: string;
    userId: string;
    organizationId: string;
    createdAt: string;
  }): void;
  createSession(args: {
    idHash: string;
    userId: string;
    organizationId: string;
    csrfHash: string;
    createdAt: string;
    expiresAt: string;
  }): void;
  getSessionByHash(idHash: string): SessionRow | null;
  hasActiveMembership(organizationId: string, userId: string): boolean;
  revokeSession(idHash: string, revokedAt: string): void;
}
