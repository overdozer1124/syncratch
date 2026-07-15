import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  GoogleIdentityClaims,
  VerifyResult,
} from "@blocksync/google-identity";
import { createProjectService } from "@blocksync/project-service";
import { createFsSnapshotStore } from "@blocksync/project-snapshots-fs";
import { openSqliteStore } from "@blocksync/project-store-sqlite";
import {
  createSessionService,
  SessionAuthContext,
} from "@blocksync/session-service";
import { CSRF_COOKIE_NAME, SESSION_COOKIE_NAME } from "./cookies.js";
import { createPersistApp } from "./server.js";

const ORIGIN = "http://localhost:5173";
const CLIENT_ID = "client.apps.googleusercontent.com";

function hash(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function claims(partial: Partial<GoogleIdentityClaims> = {}): GoogleIdentityClaims {
  return {
    sub: "sub-1",
    email: "a@example.com",
    email_verified: true,
    hd: "example.com",
    aud: CLIENT_ID,
    iss: "https://accounts.google.com",
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    ...partial,
  };
}

function parseCookies(res: Response): Map<string, { value: string; raw: string }> {
  const out = new Map<string, { value: string; raw: string }>();
  const lines =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [];
  for (const line of lines) {
    const [pair] = line.split(";");
    const eq = pair!.indexOf("=");
    out.set(pair!.slice(0, eq).trim(), {
      value: pair!.slice(eq + 1).trim(),
      raw: line,
    });
  }
  return out;
}

function cookieHeader(jar: Map<string, { value: string; raw: string }>): string {
  return [...jar.entries()]
    .map(([name, { value }]) => `${name}=${value}`)
    .join("; ");
}

type AuthRepoTest = {
  deleteMembershipKeepingSessionForTest(
    organizationId: string,
    userId: string,
  ): void;
  dumpSensitiveColumnsForTest(): {
    sessionIdHashes: string[];
    csrfHashes: string[];
    subjects: string[];
  };
  setSessionExpiresAtForTest(idHash: string, expiresAt: string): void;
  withTransaction: ReturnType<typeof openSqliteStore>["authRepo"]["withTransaction"];
};

const FIXED_UNAUTHORIZED = {
  code: "UNAUTHORIZED",
  message: "Unauthorized",
};

function makeRuntime(opts: {
  domains?: string[];
  verify: (token: string) => Promise<VerifyResult>;
}) {
  const dir = mkdtempSync(join(tmpdir(), "r1-auth-acc-"));
  const dbPath = join(dir, "projects.sqlite");
  const snapDir = join(dir, "snapshots");
  const store = openSqliteStore({ dbPath });
  const domains = opts.domains ?? ["example.com", "other.com"];
  const sessionService = createSessionService({
    authRepo: store.authRepo,
    verifyGoogleIdToken: opts.verify as never,
    googleAudience: CLIENT_ID,
    allowedHostedDomains: domains,
    sessionTtlSec: 7 * 24 * 3600,
    now: () => new Date(),
    randomToken: () => randomBytes(32).toString("base64url"),
    hash,
  });
  const auth = new SessionAuthContext({
    authRepo: store.authRepo,
    hash,
    now: () => new Date(),
  });
  const service = createProjectService({
    auth,
    repo: store.projectRepo,
    snapshots: createFsSnapshotStore(snapDir),
  });
  const app = createPersistApp({
    auth,
    service,
    authMode: "google",
    allowedOrigins: [ORIGIN],
    cookieSecure: false,
    sessionService,
    authRepo: store.authRepo,
    hash,
  });
  return {
    app,
    dbPath,
    store,
    authRepo: store.authRepo as typeof store.authRepo & AuthRepoTest,
    close: () => store.close(),
    reopen() {
      store.close();
      const next = openSqliteStore({ dbPath });
      const nextSession = createSessionService({
        authRepo: next.authRepo,
        verifyGoogleIdToken: opts.verify as never,
        googleAudience: CLIENT_ID,
        allowedHostedDomains: domains,
        sessionTtlSec: 7 * 24 * 3600,
        now: () => new Date(),
        randomToken: () => randomBytes(32).toString("base64url"),
        hash,
      });
      const nextAuth = new SessionAuthContext({
        authRepo: next.authRepo,
        hash,
        now: () => new Date(),
      });
      const nextService = createProjectService({
        auth: nextAuth,
        repo: next.projectRepo,
        snapshots: createFsSnapshotStore(snapDir),
      });
      const nextApp = createPersistApp({
        auth: nextAuth,
        service: nextService,
        authMode: "google",
        allowedOrigins: [ORIGIN],
        cookieSecure: false,
        sessionService: nextSession,
        authRepo: next.authRepo,
        hash,
      });
      return {
        app: nextApp,
        authRepo: next.authRepo as typeof next.authRepo & AuthRepoTest,
        close: () => next.close(),
      };
    },
  };
}

async function login(
  app: ReturnType<typeof createPersistApp>,
  idToken = "tok",
) {
  const res = await app.request("/v1/auth/google", {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
    },
    body: JSON.stringify({ idToken }),
  });
  return { res, cookies: parseCookies(res) };
}

describe("auth fixture acceptance", () => {
  it("two-org BOLA: org A cannot read org B project", async () => {
    let currentSub = "user-a-sub";
    let currentHd = "example.com";
    const rt = makeRuntime({
      verify: async () => ({
        ok: true,
        claims: claims({
          sub: currentSub,
          hd: currentHd,
          email: `${currentSub}@${currentHd}`,
        }),
      }),
    });
    try {
      const aLogin = await login(rt.app, "a");
      expect(aLogin.res.status).toBe(200);
      const createRes = await rt.app.request("/v1/projects", {
        method: "POST",
        headers: {
          origin: ORIGIN,
          "content-type": "application/json",
          cookie: cookieHeader(aLogin.cookies),
          "x-csrf-token": aLogin.cookies.get(CSRF_COOKIE_NAME)!.value,
        },
        body: JSON.stringify({ title: "A private" }),
      });
      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as { projectId: string };

      currentSub = "user-b-sub";
      currentHd = "other.com";
      const bLogin = await login(rt.app, "b");
      expect(bLogin.res.status).toBe(200);
      const getRes = await rt.app.request(`/v1/projects/${created.projectId}`, {
        headers: {
          cookie: cookieHeader(bLogin.cookies),
        },
      });
      // 403 forbidden or 404 not-found (no cross-tenant disclosure) both OK
      expect([403, 404]).toContain(getRes.status);
    } finally {
      rt.close();
    }
  });

  it("hd mismatch on re-login → AUTH_FAILED; bind unchanged", async () => {
    let hd = "example.com";
    const rt = makeRuntime({
      verify: async () => ({
        ok: true,
        claims: claims({ sub: "bind-sub", hd, email: `x@${hd}` }),
      }),
    });
    try {
      const first = await login(rt.app);
      expect(first.res.status).toBe(200);
      const body1 = (await first.res.json()) as {
        user: { id: string; organizationId: string };
      };
      hd = "other.com";
      const second = await login(rt.app);
      expect(second.res.status).toBe(401);
      const err = (await second.res.json()) as { code: string };
      expect(err.code).toBe("AUTH_FAILED");

      const me = await rt.app.request("/v1/auth/me", {
        headers: { cookie: cookieHeader(first.cookies) },
      });
      expect(me.status).toBe(200);
      const meBody = (await me.json()) as {
        user: { id: string; organizationId: string };
      };
      expect(meBody.user.id).toBe(body1.user.id);
      expect(meBody.user.organizationId).toBe(body1.user.organizationId);
    } finally {
      rt.close();
    }
  });

  it("membership deleted → existing session → 401", async () => {
    const rt = makeRuntime({
      verify: async () => ({ ok: true, claims: claims({}) }),
    });
    try {
      const { res, cookies } = await login(rt.app);
      expect(res.status).toBe(200);
      const meOk = await rt.app.request("/v1/auth/me", {
        headers: { cookie: cookieHeader(cookies) },
      });
      expect(meOk.status).toBe(200);
      const meBody = (await meOk.json()) as {
        user: { id: string; organizationId: string };
      };
      rt.authRepo.deleteMembershipKeepingSessionForTest(
        meBody.user.organizationId,
        meBody.user.id,
      );
      const meBad = await rt.app.request("/v1/auth/me", {
        headers: { cookie: cookieHeader(cookies) },
      });
      expect(meBad.status).toBe(401);
    } finally {
      rt.close();
    }
  });

  it("concurrent dual first-login → one identity", async () => {
    const rt = makeRuntime({
      verify: async () => ({
        ok: true,
        claims: claims({ sub: "race-sub", email: "race@example.com" }),
      }),
    });
    try {
      const [a, b] = await Promise.all([login(rt.app, "1"), login(rt.app, "2")]);
      expect(a.res.status).toBe(200);
      expect(b.res.status).toBe(200);
      const aBody = (await a.res.json()) as { user: { id: string } };
      const bBody = (await b.res.json()) as { user: { id: string } };
      expect(aBody.user.id).toBe(bBody.user.id);
      const dump = rt.authRepo.dumpSensitiveColumnsForTest();
      expect(dump.subjects.filter((s) => s === "race-sub")).toHaveLength(1);
    } finally {
      rt.close();
    }
  });

  it("expired session → 401 with fixed Unauthorized body", async () => {
    const rt = makeRuntime({
      verify: async () => ({ ok: true, claims: claims({}) }),
    });
    try {
      const { res, cookies } = await login(rt.app);
      expect(res.status).toBe(200);
      const sessionRaw = cookies.get(SESSION_COOKIE_NAME)!.value;
      rt.authRepo.setSessionExpiresAtForTest(
        hash(sessionRaw),
        "2000-01-01T00:00:00.000Z",
      );
      const me = await rt.app.request("/v1/auth/me", {
        headers: { cookie: cookieHeader(cookies) },
      });
      expect(me.status).toBe(401);
      expect(await me.json()).toEqual(FIXED_UNAUTHORIZED);
    } finally {
      rt.close();
    }
  });

  it("revoked session → 401 with fixed Unauthorized body", async () => {
    const rt = makeRuntime({
      verify: async () => ({ ok: true, claims: claims({}) }),
    });
    try {
      const { res, cookies } = await login(rt.app);
      expect(res.status).toBe(200);
      const sessionRaw = cookies.get(SESSION_COOKIE_NAME)!.value;
      rt.authRepo.withTransaction((tx) =>
        tx.revokeSession(hash(sessionRaw), new Date().toISOString()),
      );
      const me = await rt.app.request("/v1/auth/me", {
        headers: { cookie: cookieHeader(cookies) },
      });
      expect(me.status).toBe(401);
      expect(await me.json()).toEqual(FIXED_UNAUTHORIZED);
    } finally {
      rt.close();
    }
  });

  it("logout then reuse old cookies → 401 with fixed Unauthorized body", async () => {
    const rt = makeRuntime({
      verify: async () => ({ ok: true, claims: claims({}) }),
    });
    try {
      const { res, cookies } = await login(rt.app);
      expect(res.status).toBe(200);
      const csrf = cookies.get(CSRF_COOKIE_NAME)!.value;
      const logout = await rt.app.request("/v1/auth/logout", {
        method: "POST",
        headers: {
          origin: ORIGIN,
          cookie: cookieHeader(cookies),
          "x-csrf-token": csrf,
        },
      });
      expect(logout.status).toBe(204);
      const me = await rt.app.request("/v1/auth/me", {
        headers: { cookie: cookieHeader(cookies) },
      });
      expect(me.status).toBe(401);
      expect(await me.json()).toEqual(FIXED_UNAUTHORIZED);
    } finally {
      rt.close();
    }
  });

  it("auth reject reasons are not distinguishable in HTTP body", async () => {
    const rt = makeRuntime({
      verify: async () => ({ ok: true, claims: claims({}) }),
    });
    try {
      const { cookies } = await login(rt.app);
      const missing = await rt.app.request("/v1/auth/me", { headers: {} });
      const expiredCookies = cookieHeader(cookies);
      rt.authRepo.setSessionExpiresAtForTest(
        hash(cookies.get(SESSION_COOKIE_NAME)!.value),
        "not-a-date",
      );
      const invalidExpiry = await rt.app.request("/v1/auth/me", {
        headers: { cookie: expiredCookies },
      });
      expect(missing.status).toBe(401);
      expect(invalidExpiry.status).toBe(401);
      expect(await missing.json()).toEqual(FIXED_UNAUTHORIZED);
      expect(await invalidExpiry.json()).toEqual(FIXED_UNAUTHORIZED);
    } finally {
      rt.close();
    }
  });

  it("restart preserves session+csrf mutation path; raw tokens absent from DB", async () => {
    const rt = makeRuntime({
      verify: async () => ({ ok: true, claims: claims({}) }),
    });
    try {
      const { res, cookies } = await login(rt.app);
      expect(res.status).toBe(200);
      const sessionRaw = cookies.get(SESSION_COOKIE_NAME)!.value;
      const csrfRaw = cookies.get(CSRF_COOKIE_NAME)!.value;
      const dump = rt.authRepo.dumpSensitiveColumnsForTest();
      expect(dump.sessionIdHashes).not.toContain(sessionRaw);
      expect(dump.csrfHashes).not.toContain(csrfRaw);
      expect(dump.sessionIdHashes).toContain(hash(sessionRaw));
      expect(dump.csrfHashes).toContain(hash(csrfRaw));

      const { app, close } = rt.reopen();
      try {
        const createRes = await app.request("/v1/projects", {
          method: "POST",
          headers: {
            origin: ORIGIN,
            "content-type": "application/json",
            cookie: cookieHeader(cookies),
            "x-csrf-token": csrfRaw,
          },
          body: JSON.stringify({ title: "After restart" }),
        });
        expect(createRes.status).toBe(201);
      } finally {
        close();
      }
    } finally {
      // store already closed by reopen
    }
  });
});
