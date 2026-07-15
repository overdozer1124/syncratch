/**
 * @experimental R1 AuthContext — identity only. Authorization is durable elsewhere.
 */

export interface AuthRequestHints {
  headers: Record<string, string | undefined>;
  /** Session / CSRF cookies when present. Stub ignores these. */
  cookies?: Record<string, string | undefined>;
}

export interface AuthPrincipal {
  userId: string;
  organizationId: string;
  displayName?: string;
}

export interface AuthContext {
  /** Authenticate caller. Never performs project ACL. */
  resolve(request: AuthRequestHints): Promise<AuthPrincipal>;
}

const STUB_PRINCIPALS: Record<string, AuthPrincipal> = {
  "user-a": {
    userId: "user-a",
    organizationId: "org-demo",
    displayName: "User A",
  },
  "user-b": {
    userId: "user-b",
    organizationId: "org-demo",
    displayName: "User B",
  },
};

export class StubAuthContext implements AuthContext {
  async resolve(request: AuthRequestHints): Promise<AuthPrincipal> {
    const userId = request.headers["x-user-id"]?.trim();
    if (!userId) {
      throw new Error("Unauthenticated: missing x-user-id");
    }
    const principal = STUB_PRINCIPALS[userId];
    if (!principal) {
      throw new Error(`Unauthenticated: unknown user ${userId}`);
    }
    const orgOverride = request.headers["x-organization-id"]?.trim();
    if (orgOverride && orgOverride !== principal.organizationId) {
      throw new Error("Unauthenticated: organization mismatch");
    }
    return { ...principal };
  }
}
