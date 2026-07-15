import { randomUUID } from "node:crypto";
import {
  verifyGoogleIdToken,
  type VerifyGoogleIdTokenOptions,
} from "@blocksync/google-identity";
import { AuthFailedError } from "./errors.js";
import type { AuthRepository, AuthRepositoryTx } from "./ports.js";

export interface LoginSuccess {
  userId: string;
  organizationId: string;
  email: string | null;
  expiresAt: string;
  rawSessionId: string;
  rawCsrfToken: string;
}

export interface SessionService {
  loginWithGoogleIdToken(idToken: string): Promise<LoginSuccess>;
  logout(sessionIdHash: string): void;
}

export interface CreateSessionServiceDeps {
  authRepo: AuthRepository;
  verifyGoogleIdToken: typeof verifyGoogleIdToken;
  googleAudience: string;
  authorizedParties?: string[];
  allowedHostedDomains: string[];
  sessionTtlSec: number;
  now: () => Date;
  randomToken: () => string;
  hash: (raw: string) => string;
}

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  return (
    e.code === "SQLITE_CONSTRAINT_UNIQUE" ||
    e.code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
    /UNIQUE constraint failed/i.test(e.message ?? "")
  );
}

export function createSessionService(
  deps: CreateSessionServiceDeps,
): SessionService {
  const verifyOpts = (): VerifyGoogleIdTokenOptions => {
    const opts: VerifyGoogleIdTokenOptions = {
      audience: deps.googleAudience,
      allowedHostedDomains: deps.allowedHostedDomains,
      requireEmailVerified: true,
    };
    if (deps.authorizedParties && deps.authorizedParties.length > 0) {
      opts.authorizedParties = deps.authorizedParties;
    }
    return opts;
  };

  function issueSession(
    tx: AuthRepositoryTx,
    args: {
      userId: string;
      organizationId: string;
      email: string | null;
    },
  ): LoginSuccess {
    const now = deps.now();
    const expiresAt = new Date(
      now.getTime() + deps.sessionTtlSec * 1000,
    ).toISOString();
    const rawSessionId = deps.randomToken();
    const rawCsrfToken = deps.randomToken();
    tx.createSession({
      idHash: deps.hash(rawSessionId),
      userId: args.userId,
      organizationId: args.organizationId,
      csrfHash: deps.hash(rawCsrfToken),
      createdAt: now.toISOString(),
      expiresAt,
    });
    return {
      userId: args.userId,
      organizationId: args.organizationId,
      email: args.email,
      expiresAt,
      rawSessionId,
      rawCsrfToken,
    };
  }

  function loginInTx(
    tx: AuthRepositoryTx,
    claims: {
      sub: string;
      email?: string;
      hd: string;
    },
  ): LoginSuccess {
    const resolvedOrgId = tx.ensureOrgForHostedDomain(claims.hd, claims.hd);
    const identity = tx.findExternalIdentity("google", claims.sub);

    if (identity) {
      if (identity.organizationId !== resolvedOrgId) {
        throw new AuthFailedError();
      }
      if (claims.email !== undefined) {
        tx.updateUserEmail(identity.userId, claims.email ?? null);
      }
      return issueSession(tx, {
        userId: identity.userId,
        organizationId: identity.organizationId,
        email: claims.email ?? null,
      });
    }

    const userId = randomUUID();
    const nowIso = deps.now().toISOString();
    tx.createUser({
      userId,
      primaryOrganizationId: resolvedOrgId,
      email: claims.email ?? null,
      displayName: null,
      now: nowIso,
    });
    tx.ensureMembership(resolvedOrgId, userId, "member");
    tx.insertExternalIdentity({
      provider: "google",
      subject: claims.sub,
      userId,
      organizationId: resolvedOrgId,
      createdAt: nowIso,
    });
    return issueSession(tx, {
      userId,
      organizationId: resolvedOrgId,
      email: claims.email ?? null,
    });
  }

  return {
    async loginWithGoogleIdToken(idToken: string): Promise<LoginSuccess> {
      const verified = await deps.verifyGoogleIdToken(idToken, verifyOpts());
      if (!verified.ok) {
        throw new AuthFailedError();
      }
      const claims = verified.claims;
      const hd = claims.hd?.toLowerCase();
      if (
        !hd ||
        !deps.allowedHostedDomains.map((d) => d.toLowerCase()).includes(hd)
      ) {
        throw new AuthFailedError();
      }

      const payload = {
        sub: claims.sub,
        email: claims.email,
        hd,
      };

      try {
        return deps.authRepo.withTransaction((tx) => loginInTx(tx, payload));
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        // Concurrent first login: losing TX rolled back; winner's identity exists.
        return deps.authRepo.withTransaction((tx) => loginInTx(tx, payload));
      }
    },

    logout(sessionIdHash: string): void {
      deps.authRepo.withTransaction((tx) => {
        tx.revokeSession(sessionIdHash, deps.now().toISOString());
      });
    },
  };
}
