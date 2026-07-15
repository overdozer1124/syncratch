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
import { createPersistApp, type CreateServerDeps } from "./server.js";
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "./cookies.js";

const ALLOWED_ORIGIN = "http://localhost:5173";
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

function ok(c: GoogleIdentityClaims): VerifyResult {
  return { ok: true, claims: c };
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
    const name = pair!.slice(0, eq).trim();
    const value = pair!.slice(eq + 1).trim();
    out.set(name, { value, raw: line });
  }
  return out;
}

function cookieHeader(jar: Map<string, { value: string; raw: string }>): string {
  return [...jar.entries()]
    .map(([name, { value }]) => `${name}=${value}`)
    .join("; ");
}

function makeGoogleRuntime(opts?: {
  dbPath?: string;
  verify?: (token: string) => Promise<VerifyResult>;
  cookieSecure?: boolean;
}) {
  const dir = mkdtempSync(join(tmpdir(), "r1-auth-http-"));
  const dbPath = opts?.dbPath ?? join(dir, "projects.sqlite");
  const snapDir = join(dir, "snapshots");
  const store = openSqliteStore({ dbPath });
  const cookieSecure = opts?.cookieSecure ?? false;
  const verify =
    opts?.verify ??
    (async () => ok(claims()));
  const sessionService = createSessionService({
    authRepo: store.authRepo,
    verifyGoogleIdToken: verify as never,
    googleAudience: CLIENT_ID,
    allowedHostedDomains: ["example.com"],
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
  const deps: CreateServerDeps = {
    auth,
    service,
    authMode: "google",
    allowedOrigins: [ALLOWED_ORIGIN],
    cookieSecure,
    sessionService,
    authRepo: store.authRepo,
    hash,
  };
  const app = createPersistApp(deps);
  return {
    app,
    dbPath,
    dir,
    snapDir,
    authRepo: store.authRepo,
    close: () => store.close(),
    reopen() {
      store.close();
      const next = openSqliteStore({ dbPath });
      const nextSession = createSessionService({
        authRepo: next.authRepo,
        verifyGoogleIdToken: verify as never,
        googleAudience: CLIENT_ID,
        allowedHostedDomains: ["example.com"],
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
        allowedOrigins: [ALLOWED_ORIGIN],
        cookieSecure,
        sessionService: nextSession,
        authRepo: next.authRepo,
        hash,
      });
      return {
        app: nextApp,
        close: () => next.close(),
      };
    },
  };
}

async function loginOk(app: ReturnType<typeof createPersistApp>) {
  const res = await app.request("/v1/auth/google", {
    method: "POST",
    headers: {
      origin: ALLOWED_ORIGIN,
      "content-type": "application/json",
    },
    body: JSON.stringify({ idToken: "fake-id-token" }),
  });
  expect(res.status).toBe(200);
  const cookies = parseCookies(res);
  expect(cookies.has(SESSION_COOKIE_NAME)).toBe(true);
  expect(cookies.has(CSRF_COOKIE_NAME)).toBe(true);
  return { res, cookies };
}

describe("auth routes (google mode)", () => {
  it("login without Origin → 403", async () => {
    const { app, close } = makeGoogleRuntime();
    try {
      const res = await app.request("/v1/auth/google", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ idToken: "t" }),
      });
      expect(res.status).toBe(403);
    } finally {
      close();
    }
  });

  it("login with wrong Origin → 403", async () => {
    const { app, close } = makeGoogleRuntime();
    try {
      const res = await app.request("/v1/auth/google", {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({ idToken: "t" }),
      });
      expect(res.status).toBe(403);
    } finally {
      close();
    }
  });

  it("login OK sets session + csrf cookies", async () => {
    const { app, close } = makeGoogleRuntime();
    try {
      const { cookies } = await loginOk(app);
      const session = cookies.get(SESSION_COOKIE_NAME)!;
      const csrf = cookies.get(CSRF_COOKIE_NAME)!;
      expect(session.value.length).toBeGreaterThan(20);
      expect(csrf.value.length).toBeGreaterThan(20);
      expect(session.raw).toMatch(/HttpOnly/i);
      expect(csrf.raw).not.toMatch(/HttpOnly/i);
      expect(session.raw).toMatch(/SameSite=Lax/i);
      expect(csrf.raw).toMatch(/SameSite=Lax/i);
      expect(session.raw).toMatch(/Path=\//i);
      expect(csrf.raw).toMatch(/Path=\//i);
    } finally {
      close();
    }
  });

  it("mutation: missing CSRF cookie → 403", async () => {
    const { app, close } = makeGoogleRuntime();
    try {
      const { cookies } = await loginOk(app);
      const session = cookies.get(SESSION_COOKIE_NAME)!;
      const res = await app.request("/v1/projects", {
        method: "POST",
        headers: {
          origin: ALLOWED_ORIGIN,
          "content-type": "application/json",
          cookie: `${SESSION_COOKIE_NAME}=${session.value}`,
          "x-csrf-token": cookies.get(CSRF_COOKIE_NAME)!.value,
        },
        body: JSON.stringify({ title: "X" }),
      });
      expect(res.status).toBe(403);
    } finally {
      close();
    }
  });

  it("mutation: missing X-CSRF-Token → 403", async () => {
    const { app, close } = makeGoogleRuntime();
    try {
      const { cookies } = await loginOk(app);
      const res = await app.request("/v1/projects", {
        method: "POST",
        headers: {
          origin: ALLOWED_ORIGIN,
          "content-type": "application/json",
          cookie: cookieHeader(cookies),
        },
        body: JSON.stringify({ title: "X" }),
      });
      expect(res.status).toBe(403);
    } finally {
      close();
    }
  });

  it("mutation: CSRF cookie/header mismatch → 403", async () => {
    const { app, close } = makeGoogleRuntime();
    try {
      const { cookies } = await loginOk(app);
      const res = await app.request("/v1/projects", {
        method: "POST",
        headers: {
          origin: ALLOWED_ORIGIN,
          "content-type": "application/json",
          cookie: cookieHeader(cookies),
          "x-csrf-token": "not-the-csrf-cookie-value",
        },
        body: JSON.stringify({ title: "X" }),
      });
      expect(res.status).toBe(403);
    } finally {
      close();
    }
  });

  it("mutation without Origin → 403", async () => {
    const { app, close } = makeGoogleRuntime();
    try {
      const { cookies } = await loginOk(app);
      const csrf = cookies.get(CSRF_COOKIE_NAME)!.value;
      const res = await app.request("/v1/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: cookieHeader(cookies),
          "x-csrf-token": csrf,
        },
        body: JSON.stringify({ title: "X" }),
      });
      expect(res.status).toBe(403);
    } finally {
      close();
    }
  });

  it("mutation with CSRF + Origin OK after restart (same dbPath)", async () => {
    const runtime = makeGoogleRuntime();
    try {
      const { cookies } = await loginOk(runtime.app);
      const csrf = cookies.get(CSRF_COOKIE_NAME)!.value;
      const cookie = cookieHeader(cookies);

      const restarted = runtime.reopen();
      try {
        const res = await restarted.app.request("/v1/projects", {
          method: "POST",
          headers: {
            origin: ALLOWED_ORIGIN,
            "content-type": "application/json",
            cookie,
            "x-csrf-token": csrf,
          },
          body: JSON.stringify({ title: "AfterRestart" }),
        });
        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.title).toBe("AfterRestart");
      } finally {
        restarted.close();
      }
    } finally {
      // first store already closed by reopen
    }
  });

  it("CORS OPTIONS preflight allow-listed Origin → ACAO exact + ACAC true + Vary: Origin", async () => {
    const { app, close } = makeGoogleRuntime();
    try {
      const res = await app.request("/v1/auth/google", {
        method: "OPTIONS",
        headers: {
          origin: ALLOWED_ORIGIN,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type",
        },
      });
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);
      expect(res.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
      expect(res.headers.get("access-control-allow-credentials")).toBe("true");
      expect(res.headers.get("vary")).toMatch(/Origin/i);
    } finally {
      close();
    }
  });

  it("CORS disallowed Origin → no Access-Control-Allow-Origin", async () => {
    const { app, close } = makeGoogleRuntime();
    try {
      const res = await app.request("/v1/auth/google", {
        method: "OPTIONS",
        headers: {
          origin: "https://evil.example",
          "access-control-request-method": "POST",
        },
      });
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      close();
    }
  });

  it("logout clears both cookies with same Secure/SameSite/Path", async () => {
    const { app, close } = makeGoogleRuntime();
    try {
      const { cookies } = await loginOk(app);
      const csrf = cookies.get(CSRF_COOKIE_NAME)!.value;
      const logout = await app.request("/v1/auth/logout", {
        method: "POST",
        headers: {
          origin: ALLOWED_ORIGIN,
          cookie: cookieHeader(cookies),
          "x-csrf-token": csrf,
        },
      });
      expect(logout.status).toBe(204);
      const cleared = parseCookies(logout);
      const sessionClear = cleared.get(SESSION_COOKIE_NAME);
      const csrfClear = cleared.get(CSRF_COOKIE_NAME);
      expect(sessionClear).toBeTruthy();
      expect(csrfClear).toBeTruthy();
      for (const raw of [sessionClear!.raw, csrfClear!.raw]) {
        expect(raw).toMatch(/SameSite=Lax/i);
        expect(raw).toMatch(/Path=\//i);
        expect(raw).toMatch(/Max-Age=0/i);
        // cookieSecure=false in tests → no Secure attribute on set or clear
        expect(raw).not.toMatch(/(?:^|;)\s*Secure(?:;|$)/i);
      }
      expect(sessionClear!.raw).toMatch(/HttpOnly/i);
      expect(csrfClear!.raw).not.toMatch(/HttpOnly/i);
    } finally {
      close();
    }
  });

  it("cookieSecure=true sets and clears Secure on session and csrf cookies", async () => {
    const { app, close } = makeGoogleRuntime({ cookieSecure: true });
    try {
      const { cookies, res } = await loginOk(app);
      const setSession = parseCookies(res).get(SESSION_COOKIE_NAME)!;
      const setCsrf = parseCookies(res).get(CSRF_COOKIE_NAME)!;
      expect(setSession.raw).toMatch(/(?:^|;)\s*Secure(?:;|$)/i);
      expect(setCsrf.raw).toMatch(/(?:^|;)\s*Secure(?:;|$)/i);

      const logout = await app.request("/v1/auth/logout", {
        method: "POST",
        headers: {
          origin: ALLOWED_ORIGIN,
          cookie: cookieHeader(cookies),
          "x-csrf-token": cookies.get(CSRF_COOKIE_NAME)!.value,
        },
      });
      expect(logout.status).toBe(204);
      const cleared = parseCookies(logout);
      expect(cleared.get(SESSION_COOKIE_NAME)!.raw).toMatch(
        /(?:^|;)\s*Secure(?:;|$)/i,
      );
      expect(cleared.get(CSRF_COOKIE_NAME)!.raw).toMatch(
        /(?:^|;)\s*Secure(?:;|$)/i,
      );
    } finally {
      close();
    }
  });

  it("verify failure codes all map to identical AUTH_FAILED body", async () => {
    const codes = [
      "BAD_SIGNATURE",
      "BAD_AUD",
      "BAD_ISS",
      "EXPIRED",
      "EMAIL_NOT_VERIFIED",
      "HD_MISSING",
      "HD_MISMATCH",
    ] as const;
    const bodies: string[] = [];
    for (const code of codes) {
      const { app, close } = makeGoogleRuntime({
        verify: async () => ({
          ok: false,
          code,
          message: `internal ${code}`,
        }),
      });
      try {
        const res = await app.request("/v1/auth/google", {
          method: "POST",
          headers: {
            origin: ALLOWED_ORIGIN,
            "content-type": "application/json",
          },
          body: JSON.stringify({ idToken: "x" }),
        });
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body).toEqual({
          code: "AUTH_FAILED",
          message: "Authentication failed",
        });
        bodies.push(JSON.stringify(body));
      } finally {
        close();
      }
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it("spoof headers ignored under google mode", async () => {
    const { app, close } = makeGoogleRuntime();
    try {
      const { cookies } = await loginOk(app);
      const csrf = cookies.get(CSRF_COOKIE_NAME)!.value;
      const created = await app.request("/v1/projects", {
        method: "POST",
        headers: {
          origin: ALLOWED_ORIGIN,
          "content-type": "application/json",
          cookie: cookieHeader(cookies),
          "x-csrf-token": csrf,
          "x-user-id": "user-a",
          "x-organization-id": "org-demo",
        },
        body: JSON.stringify({ title: "Owned" }),
      });
      expect(created.status).toBe(201);
      const envelope = await created.json();

      // user-a spoof must not list the google-owned project when unauthenticated as stub
      const listAsSpoof = await app.request("/v1/projects", {
        method: "GET",
        headers: {
          cookie: cookieHeader(cookies),
          "x-user-id": "user-b",
        },
      });
      expect(listAsSpoof.status).toBe(200);
      const listed = await listAsSpoof.json();
      expect(listed.projects.some((p: { projectId: string }) => p.projectId === envelope.projectId)).toBe(
        true,
      );

      // Without session cookie, spoof headers alone must not authenticate
      const spoofOnly = await app.request("/v1/projects", {
        method: "GET",
        headers: {
          "x-user-id": "user-a",
        },
      });
      expect(spoofOnly.status).toBe(401);
    } finally {
      close();
    }
  });
});
