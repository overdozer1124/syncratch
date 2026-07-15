import type { AuthContext, AuthPrincipal, AuthRequestHints } from "@blocksync/auth-context";
import type { AuthRepository } from "./ports.js";

export class UnauthenticatedError extends Error {
  constructor(message = "Unauthenticated") {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export interface SessionAuthContextDeps {
  authRepo: AuthRepository;
  hash: (raw: string) => string;
  now: () => Date;
  sessionCookieName?: string;
}

export class SessionAuthContext implements AuthContext {
  private readonly authRepo: AuthRepository;
  private readonly hash: (raw: string) => string;
  private readonly now: () => Date;
  private readonly sessionCookieName: string;

  constructor(deps: SessionAuthContextDeps) {
    this.authRepo = deps.authRepo;
    this.hash = deps.hash;
    this.now = deps.now;
    this.sessionCookieName = deps.sessionCookieName ?? "blocksync_session";
  }

  async resolve(request: AuthRequestHints): Promise<AuthPrincipal> {
    const raw = request.cookies?.[this.sessionCookieName]?.trim();
    if (!raw) {
      throw new UnauthenticatedError("missing session cookie");
    }

    const idHash = this.hash(raw);
    const row = this.authRepo.withTransaction((tx) => tx.getSessionByHash(idHash));
    if (!row) {
      throw new UnauthenticatedError("unknown session");
    }
    if (row.revokedAt) {
      throw new UnauthenticatedError("session revoked");
    }
    const expiresMs = Date.parse(row.expiresAt);
    if (!Number.isFinite(expiresMs) || expiresMs <= this.now().getTime()) {
      throw new UnauthenticatedError(
        Number.isFinite(expiresMs) ? "session expired" : "session expires_at invalid",
      );
    }

    const membershipOk = this.authRepo.withTransaction((tx) =>
      tx.hasActiveMembership(row.organizationId, row.userId),
    );
    if (!membershipOk) {
      throw new UnauthenticatedError("membership inactive");
    }

    // Spoof headers (x-user-id / x-organization-id) are intentionally ignored.
    return {
      userId: row.userId,
      organizationId: row.organizationId,
    };
  }
}
