import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  AuthRepository,
  AuthRepositoryTx,
  SessionRow,
} from "@blocksync/session-service";

export function createSqliteAuthRepository(db: Database.Database): AuthRepository & {
  /** Test helpers — not part of the AuthRepository port. */
  deleteMembershipForTest(organizationId: string, userId: string): void;
  /** Deletes membership while keeping sessions (FK briefly disabled) for resolve tests. */
  deleteMembershipKeepingSessionForTest(
    organizationId: string,
    userId: string,
  ): void;
  disableUserForTest(userId: string): void;
  /** Read-only dump for secret-leak assertions. */
  dumpSensitiveColumnsForTest(): {
    sessionIdHashes: string[];
    csrfHashes: string[];
    subjects: string[];
  };
} {
  const stmts = {
    findOrgByHd: db.prepare(`
      SELECT organization_id AS organizationId
      FROM organization_domains
      WHERE hosted_domain = ?
    `),
    insertOrg: db.prepare(`
      INSERT INTO organizations (id, name, status, created_at)
      VALUES (@id, @name, 'active', @createdAt)
    `),
    insertDomain: db.prepare(`
      INSERT INTO organization_domains (organization_id, hosted_domain)
      VALUES (?, ?)
    `),
    findIdentity: db.prepare(`
      SELECT user_id AS userId, organization_id AS organizationId
      FROM external_identities
      WHERE provider = ? AND subject = ?
    `),
    insertUser: db.prepare(`
      INSERT INTO users (
        id, primary_organization_id, display_name, email, status, created_at, updated_at
      ) VALUES (
        @userId, @primaryOrganizationId, @displayName, @email, 'active', @now, @now
      )
    `),
    updateEmail: db.prepare(`
      UPDATE users SET email = ?, updated_at = ? WHERE id = ?
    `),
    insertMembership: db.prepare(`
      INSERT OR IGNORE INTO organization_memberships (organization_id, user_id, role)
      VALUES (?, ?, ?)
    `),
    insertIdentity: db.prepare(`
      INSERT INTO external_identities (
        provider, subject, user_id, organization_id, created_at
      ) VALUES (
        @provider, @subject, @userId, @organizationId, @createdAt
      )
    `),
    insertSession: db.prepare(`
      INSERT INTO sessions (
        id_hash, user_id, organization_id, csrf_hash, created_at, expires_at, revoked_at, last_seen_at
      ) VALUES (
        @idHash, @userId, @organizationId, @csrfHash, @createdAt, @expiresAt, NULL, NULL
      )
    `),
    getSession: db.prepare(`
      SELECT
        id_hash AS idHash,
        user_id AS userId,
        organization_id AS organizationId,
        csrf_hash AS csrfHash,
        created_at AS createdAt,
        expires_at AS expiresAt,
        revoked_at AS revokedAt,
        last_seen_at AS lastSeenAt
      FROM sessions
      WHERE id_hash = ?
    `),
    hasMembership: db.prepare(`
      SELECT 1 AS ok
      FROM organization_memberships m
      INNER JOIN users u ON u.id = m.user_id
      INNER JOIN organizations o ON o.id = m.organization_id
      WHERE m.organization_id = ?
        AND m.user_id = ?
        AND u.status = 'active'
        AND o.status = 'active'
    `),
    revokeSession: db.prepare(`
      UPDATE sessions SET revoked_at = ? WHERE id_hash = ?
    `),
    deleteSessionsForMember: db.prepare(`
      DELETE FROM sessions
      WHERE organization_id = ? AND user_id = ?
    `),
    deleteMembership: db.prepare(`
      DELETE FROM organization_memberships
      WHERE organization_id = ? AND user_id = ?
    `),
    disableUser: db.prepare(`
      UPDATE users SET status = 'disabled', updated_at = ? WHERE id = ?
    `),
  };

  const createTx = (): AuthRepositoryTx => ({
    findOrgIdByHostedDomain(hd) {
      const row = stmts.findOrgByHd.get(hd.toLowerCase()) as
        | { organizationId: string }
        | undefined;
      return row?.organizationId ?? null;
    },

    ensureOrgForHostedDomain(hd, name) {
      const normalized = hd.toLowerCase();
      const existing = this.findOrgIdByHostedDomain(normalized);
      if (existing) return existing;
      const id = randomUUID();
      const createdAt = new Date().toISOString();
      stmts.insertOrg.run({ id, name, createdAt });
      stmts.insertDomain.run(id, normalized);
      return id;
    },

    findExternalIdentity(provider, subject) {
      const row = stmts.findIdentity.get(provider, subject) as
        | { userId: string; organizationId: string }
        | undefined;
      return row ?? null;
    },

    createUser(args) {
      stmts.insertUser.run({
        userId: args.userId,
        primaryOrganizationId: args.primaryOrganizationId,
        displayName: args.displayName ?? null,
        email: args.email,
        now: args.now,
      });
    },

    updateUserEmail(userId, email) {
      stmts.updateEmail.run(email, new Date().toISOString(), userId);
    },

    ensureMembership(organizationId, userId, role) {
      stmts.insertMembership.run(organizationId, userId, role);
    },

    insertExternalIdentity(args) {
      stmts.insertIdentity.run({
        provider: args.provider,
        subject: args.subject,
        userId: args.userId,
        organizationId: args.organizationId,
        createdAt: args.createdAt,
      });
    },

    createSession(args) {
      stmts.insertSession.run(args);
    },

    getSessionByHash(idHash) {
      const row = stmts.getSession.get(idHash) as SessionRow | undefined;
      return row ?? null;
    },

    hasActiveMembership(organizationId, userId) {
      const row = stmts.hasMembership.get(organizationId, userId) as
        | { ok: number }
        | undefined;
      return Boolean(row);
    },

    revokeSession(idHash, revokedAt) {
      stmts.revokeSession.run(revokedAt, idHash);
    },
  });

  const txApi = createTx();

  return {
    withTransaction<T>(fn: (tx: AuthRepositoryTx) => T): T {
      const run = db.transaction(() => fn(txApi));
      return run();
    },
    deleteMembershipForTest(organizationId, userId) {
      // sessions FK → memberships; clear child rows first
      stmts.deleteSessionsForMember.run(organizationId, userId);
      stmts.deleteMembership.run(organizationId, userId);
    },
    deleteMembershipKeepingSessionForTest(organizationId, userId) {
      db.pragma("foreign_keys = OFF");
      try {
        stmts.deleteMembership.run(organizationId, userId);
      } finally {
        db.pragma("foreign_keys = ON");
      }
    },
    disableUserForTest(userId) {
      stmts.disableUser.run(new Date().toISOString(), userId);
    },
    dumpSensitiveColumnsForTest() {
      const sessions = db
        .prepare(
          `SELECT id_hash AS idHash, csrf_hash AS csrfHash FROM sessions`,
        )
        .all() as Array<{ idHash: string; csrfHash: string }>;
      const subjects = db
        .prepare(`SELECT subject FROM external_identities`)
        .all() as Array<{ subject: string }>;
      return {
        sessionIdHashes: sessions.map((s) => s.idHash),
        csrfHashes: sessions.map((s) => s.csrfHash),
        subjects: subjects.map((s) => s.subject),
      };
    },
  };
}
