import type {
  AuthRepository,
  AuthRepositoryTx,
  SessionRow,
} from "./ports.js";

type State = {
  orgs: Map<string, { id: string; name: string }>;
  domains: Map<string, string>;
  users: Map<
    string,
    {
      userId: string;
      primaryOrganizationId: string;
      email: string | null;
      displayName: string | null;
      status: "active" | "disabled";
    }
  >;
  memberships: Set<string>;
  identities: Map<string, { userId: string; organizationId: string }>;
  sessions: Map<string, SessionRow>;
};

function cloneState(s: State): State {
  return {
    orgs: new Map(s.orgs),
    domains: new Map(s.domains),
    users: new Map([...s.users.entries()].map(([k, v]) => [k, { ...v }])),
    memberships: new Set(s.memberships),
    identities: new Map(
      [...s.identities.entries()].map(([k, v]) => [k, { ...v }]),
    ),
    sessions: new Map(
      [...s.sessions.entries()].map(([k, v]) => [k, { ...v }]),
    ),
  };
}

function makeTx(state: State): AuthRepositoryTx {
  return {
    findOrgIdByHostedDomain(hd) {
      return state.domains.get(hd.toLowerCase()) ?? null;
    },
    ensureOrgForHostedDomain(hd, name) {
      const key = hd.toLowerCase();
      const existing = state.domains.get(key);
      if (existing) return existing;
      const id = `org-${key}`;
      state.orgs.set(id, { id, name });
      state.domains.set(key, id);
      return id;
    },
    findExternalIdentity(provider, subject) {
      return state.identities.get(`${provider}:${subject}`) ?? null;
    },
    createUser(args) {
      state.users.set(args.userId, {
        userId: args.userId,
        primaryOrganizationId: args.primaryOrganizationId,
        email: args.email,
        displayName: args.displayName ?? null,
        status: "active",
      });
    },
    updateUserEmail(userId, email) {
      const u = state.users.get(userId);
      if (u) u.email = email;
    },
    ensureMembership(organizationId, userId, _role) {
      state.memberships.add(`${organizationId}|${userId}`);
    },
    insertExternalIdentity(args) {
      const key = `${args.provider}:${args.subject}`;
      if (state.identities.has(key)) {
        const err = new Error("UNIQUE constraint failed: external_identities");
        (err as { code?: string }).code = "SQLITE_CONSTRAINT_UNIQUE";
        throw err;
      }
      state.identities.set(key, {
        userId: args.userId,
        organizationId: args.organizationId,
      });
    },
    createSession(args) {
      if (!state.memberships.has(`${args.organizationId}|${args.userId}`)) {
        throw new Error("FOREIGN KEY constraint failed");
      }
      state.sessions.set(args.idHash, {
        idHash: args.idHash,
        userId: args.userId,
        organizationId: args.organizationId,
        csrfHash: args.csrfHash,
        createdAt: args.createdAt,
        expiresAt: args.expiresAt,
        revokedAt: null,
        lastSeenAt: null,
      });
    },
    getSessionByHash(idHash) {
      return state.sessions.get(idHash) ?? null;
    },
    hasActiveMembership(organizationId, userId) {
      const u = state.users.get(userId);
      if (!u || u.status !== "active") return false;
      return state.memberships.has(`${organizationId}|${userId}`);
    },
    revokeSession(idHash, revokedAt) {
      const s = state.sessions.get(idHash);
      if (s) s.revokedAt = revokedAt;
    },
  };
}

/** In-memory AuthRepository for unit tests (no SQLite). */
export function createMemoryAuthRepository(): AuthRepository & {
  dump(): {
    identities: Array<{
      subject: string;
      userId: string;
      organizationId: string;
    }>;
    users: Array<{
      userId: string;
      email: string | null;
      displayName: string | null;
    }>;
    memberships: Array<{ organizationId: string; userId: string }>;
  };
  /** Force unique-constraint race for concurrent first-login coverage. */
  forceNextInsertCollision(): void;
  disableUserForTest(userId: string): void;
  deleteMembershipForTest(organizationId: string, userId: string): void;
} {
  let state: State = {
    orgs: new Map(),
    domains: new Map(),
    users: new Map(),
    memberships: new Set(),
    identities: new Map(),
    sessions: new Map(),
  };
  let forceCollision = false;

  return {
    forceNextInsertCollision() {
      forceCollision = true;
    },
    disableUserForTest(userId) {
      const u = state.users.get(userId);
      if (u) u.status = "disabled";
    },
    deleteMembershipForTest(organizationId, userId) {
      state.sessions.forEach((s, key) => {
        if (s.organizationId === organizationId && s.userId === userId) {
          state.sessions.delete(key);
        }
      });
      state.memberships.delete(`${organizationId}|${userId}`);
    },
    withTransaction<T>(fn: (inner: AuthRepositoryTx) => T): T {
      const snapshot = cloneState(state);
      const working = cloneState(state);
      const tx = makeTx(working);
      if (forceCollision) {
        tx.insertExternalIdentity = (args) => {
          forceCollision = false;
          // Concurrent winner committed before our TX rolls back
          const orgId = args.organizationId;
          if (!state.domains.has("example.com")) {
            state.orgs.set(orgId, { id: orgId, name: "example.com" });
            state.domains.set("example.com", orgId);
          }
          state.users.set("winner-user", {
            userId: "winner-user",
            primaryOrganizationId: orgId,
            email: null,
            displayName: null,
            status: "active",
          });
          state.memberships.add(`${orgId}|winner-user`);
          state.identities.set(`${args.provider}:${args.subject}`, {
            userId: "winner-user",
            organizationId: orgId,
          });
          const err = new Error("UNIQUE constraint failed: external_identities");
          (err as { code?: string }).code = "SQLITE_CONSTRAINT_UNIQUE";
          throw err;
        };
      }
      try {
        const result = fn(tx);
        // Merge working onto durable state (preserve concurrent winner writes)
        state = {
          orgs: new Map([...state.orgs, ...working.orgs]),
          domains: new Map([...state.domains, ...working.domains]),
          users: new Map([...state.users, ...working.users]),
          memberships: new Set([...state.memberships, ...working.memberships]),
          identities: new Map([...state.identities, ...working.identities]),
          sessions: new Map([...state.sessions, ...working.sessions]),
        };
        return result;
      } catch (err) {
        // Roll back only this TX's working copy; keep concurrent commits on state
        void snapshot;
        throw err;
      }
    },
    dump() {
      return {
        identities: [...state.identities.entries()].map(([k, v]) => ({
          subject: k.split(":")[1]!,
          userId: v.userId,
          organizationId: v.organizationId,
        })),
        users: [...state.users.values()].map((u) => ({
          userId: u.userId,
          email: u.email,
          displayName: u.displayName,
        })),
        memberships: [...state.memberships].map((m) => {
          const [organizationId, userId] = m.split("|");
          return { organizationId: organizationId!, userId: userId! };
        }),
      };
    },
  };
}
