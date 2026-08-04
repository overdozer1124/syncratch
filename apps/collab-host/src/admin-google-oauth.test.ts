import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {IncomingMessage, ServerResponse} from "node:http";
import Database from "better-sqlite3";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
  ADMIN_AUTH_GOOGLE_PATH,
  ADMIN_GOOGLE_OAUTH_CALLBACK_PATH,
  ADMIN_GOOGLE_OAUTH_DISCONNECT_PATH,
  ADMIN_GOOGLE_OAUTH_SESSION_PATH,
  ADMIN_GOOGLE_OAUTH_START_PATH,
} from "@blocksync/classroom-access";
import {DRIVE_FILE_SCOPE} from "@blocksync/google-drive-sync";
import {
  ADMIN_SESSION_COOKIE,
  createMemoryAdminSessionStore,
  type AdminAuthConfig,
} from "./admin-auth.js";
import {openAdminDb} from "./admin-db.js";
import {createAdminGoogleCredentialStore} from "./admin-google-credential-store.js";
import {
  createAdminGoogleOAuthHandler,
  readAdminGoogleOAuthConfigFromEnv,
  type AdminGoogleOAuthConfig,
} from "./admin-google-oauth.js";
import {testAdminGoogleCryptoKeys} from "./admin-token-crypto.js";
import {resetClassroomFeatureFlagsCacheForTests} from "./classroom-feature-flags-runtime.js";
import {startCollabHost, type CollabHostHandle} from "./server.js";

let handle: CollabHostHandle | undefined;

beforeEach(() => {
  resetClassroomFeatureFlagsCacheForTests();
});

afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

function mockRes() {
  const headers = new Map<string, string | number | string[]>();
  let statusCode = 0;
  let body = "";
  const res = {
    writeHead(status: number, hdrs?: Record<string, string>) {
      statusCode = status;
      if (hdrs) {
        for (const [key, value] of Object.entries(hdrs)) {
          headers.set(key.toLowerCase(), value);
        }
      }
      return res;
    },
    setHeader(name: string, value: string | string[]) {
      headers.set(name.toLowerCase(), value);
    },
    getHeader(name: string) {
      return headers.get(name.toLowerCase());
    },
    end(chunk?: string) {
      body = chunk ?? "";
    },
  } as unknown as ServerResponse;
  return {
    res,
    get status() {
      return statusCode;
    },
    get body() {
      return body;
    },
    get headers() {
      return headers;
    },
  };
}

function mockReq(
  url: string,
  options: {method?: string; headers?: Record<string, string>} = {},
): IncomingMessage {
  return {
    url,
    method: options.method ?? "GET",
    headers: options.headers ?? {host: "localhost:8080"},
  } as IncomingMessage;
}

function claims(email: string, sub: string) {
  return {
    ok: true as const,
    claims: {
      sub,
      email,
      email_verified: true,
      aud: "test-client.apps.googleusercontent.com",
      iss: "https://accounts.google.com",
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    },
  };
}

async function loginAdmin(
  baseUrl: string,
  cookieJar: {cookie: string; csrfToken: string},
  config: AdminAuthConfig,
) {
  const response = await fetch(new URL(ADMIN_AUTH_GOOGLE_PATH, baseUrl), {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({idToken: "tok"}),
  });
  expect(response.status).toBe(200);
  const setCookies = response.headers.getSetCookie?.() ?? [];
  const parts: string[] = [];
  let csrfToken = "";
  for (const raw of setCookies) {
    const pair = raw.split(";")[0] ?? "";
    parts.push(pair);
    if (pair.startsWith("syncratch_admin_csrf=")) {
      csrfToken = decodeURIComponent(pair.slice("syncratch_admin_csrf=".length));
    }
  }
  cookieJar.cookie = parts.join("; ");
  cookieJar.csrfToken = csrfToken;
}

describe("readAdminGoogleOAuthConfigFromEnv", () => {
  it("requires client id and secret", () => {
    expect(readAdminGoogleOAuthConfigFromEnv({})).toBeNull();
    expect(
      readAdminGoogleOAuthConfigFromEnv({
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
      }),
    ).toMatchObject({clientId: "id", clientSecret: "secret"});
  });
});

describe("admin google oauth handler", () => {
  const cryptoKeys = testAdminGoogleCryptoKeys();
  const oauthConfig: AdminGoogleOAuthConfig = {
    clientId: "client",
    clientSecret: "secret",
    redirectUri: "http://localhost:8080/oauth/admin-google/callback",
    cookieSecure: false,
    now: () => 1_000_000,
  };

  function createHandler(db: Database.Database, enabled = true) {
    const adminSessions = createMemoryAdminSessionStore();
    const adminConfig: AdminAuthConfig = {
      clientId: "client",
      allowlist: new Set(["teacher@school.example"]),
      cookieSecure: false,
    };
    db.prepare(
      `INSERT OR IGNORE INTO admin_accounts (
        admin_id, subject, email, display_name, status, created_at, updated_at
      ) VALUES ('admin-1', 'sub-1', 'teacher@school.example', NULL, 'active', 't0', 't0')`,
    ).run();
    adminSessions.put("sess-1", {
      adminId: "admin-1",
      subject: "sub-1",
      email: "teacher@school.example",
      csrfToken: "csrf-1",
      expiresAt: 9_000_000,
    });
    return createAdminGoogleOAuthHandler({
      enabled,
      db,
      adminConfig,
      adminSessions,
      oauthConfig,
      cryptoKeys,
      store: createAdminGoogleCredentialStore(db, cryptoKeys),
    });
  }

  it("returns 404 when feature flag chain is OFF", async () => {
    const db = openAdminDb(":memory:");
    const handleOAuth = createHandler(db.sqlite, false);
    const out = mockRes();
    expect(await handleOAuth(mockReq(ADMIN_GOOGLE_OAUTH_START_PATH), out.res)).toBe(
      true,
    );
    expect(out.status).toBe(404);
    db.close();
  });

  it("requests drive.file scope only at authorize redirect", async () => {
    const db = openAdminDb(":memory:");
    const handleOAuth = createHandler(db.sqlite);
    const out = mockRes();
    await handleOAuth(
      mockReq(ADMIN_GOOGLE_OAUTH_START_PATH, {
        headers: {
          host: "localhost:8080",
          cookie: `${ADMIN_SESSION_COOKIE}=sess-1`,
        },
      }),
      out.res,
    );
    expect(out.status).toBe(302);
    const location = new URL(String(out.headers.get("location")));
    expect(location.searchParams.get("scope")).toBe(DRIVE_FILE_SCOPE);
    expect(location.searchParams.get("scope")).not.toContain("userinfo.profile");
    db.close();
  });

  it("requires admin session before starting OAuth", async () => {
    const db = openAdminDb(":memory:");
    const handleOAuth = createHandler(db.sqlite);
    const out = mockRes();
    await handleOAuth(mockReq(ADMIN_GOOGLE_OAUTH_START_PATH), out.res);
    expect(out.status).toBe(401);
    db.close();
  });

  it("survives DB reopen between start and callback", async () => {
    const root = mkdtempSync(join(tmpdir(), "admin-google-oauth-restart-"));
    const dbPath = join(root, "admin.sqlite");
    const db1 = openAdminDb(dbPath);
    db1.upsertAdminFromLogin({
      subject: "sub-1",
      email: "teacher@school.example",
      displayName: null,
    });
    const admin = db1.getAdminById(
      (db1.sqlite
        .prepare(`SELECT admin_id FROM admin_accounts LIMIT 1`)
        .get() as {admin_id: string}).admin_id,
    )!;

    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/token") || url.includes("/token?")) {
        return new Response(
          JSON.stringify({
            access_token: "access-1",
            refresh_token: "refresh-1",
            expires_in: 3600,
            scope: DRIVE_FILE_SCOPE,
          }),
          {status: 200, headers: {"content-type": "application/json"}},
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    });

    const adminSessions = createMemoryAdminSessionStore();
    adminSessions.put("sess-1", {
      adminId: admin.adminId,
      subject: admin.subject,
      email: admin.email,
      csrfToken: "csrf-1",
      expiresAt: 9_000_000,
    });

    const handler1 = createAdminGoogleOAuthHandler({
      enabled: true,
      db: db1.sqlite,
      adminConfig: {
        clientId: "client",
        allowlist: new Set(["teacher@school.example"]),
        cookieSecure: false,
      },
      adminSessions,
      oauthConfig: {...oauthConfig, fetch: fetchImpl as unknown as typeof fetch},
      cryptoKeys,
      store: createAdminGoogleCredentialStore(db1.sqlite, cryptoKeys),
    });

    const startOut = mockRes();
    await handler1(
      mockReq(ADMIN_GOOGLE_OAUTH_START_PATH, {
        headers: {
          host: "localhost:8080",
          cookie: `${ADMIN_SESSION_COOKIE}=sess-1`,
        },
      }),
      startOut.res,
    );
    const state = new URL(String(startOut.headers.get("location"))).searchParams.get(
      "state",
    );
    expect(state).toBeTruthy();
    db1.close();

    const db2 = openAdminDb(dbPath);
    const handler2 = createAdminGoogleOAuthHandler({
      enabled: true,
      db: db2.sqlite,
      adminConfig: {
        clientId: "client",
        allowlist: new Set(["teacher@school.example"]),
        cookieSecure: false,
      },
      adminSessions,
      oauthConfig: {...oauthConfig, fetch: fetchImpl as unknown as typeof fetch},
      cryptoKeys,
      store: createAdminGoogleCredentialStore(db2.sqlite, cryptoKeys),
    });

    const callbackOut = mockRes();
    await handler2(
      mockReq(
        `${ADMIN_GOOGLE_OAUTH_CALLBACK_PATH}?code=abc&state=${encodeURIComponent(state!)}`,
      ),
      callbackOut.res,
    );
    expect(callbackOut.status).toBe(302);
    expect(String(callbackOut.headers.get("location"))).toContain("admin_google_oauth=ok");
    expect(
      db2.sqlite
        .prepare(`SELECT COUNT(*) AS c FROM admin_google_credentials`)
        .get() as {c: number},
    ).toEqual({c: 1});
    db2.close();
  });

  it("consumes pending OAuth state exactly once", async () => {
    const db = openAdminDb(":memory:");
    db.sqlite.prepare(
      `INSERT INTO admin_accounts (
        admin_id, subject, email, display_name, status, created_at, updated_at
      ) VALUES ('admin-1', 'sub-1', 'teacher@school.example', NULL, 'active', 't0', 't0')`,
    ).run();
    const store = createAdminGoogleCredentialStore(db.sqlite, cryptoKeys);
    store.putPendingOAuth(
      "state-1",
      {adminId: "admin-1", codeVerifier: "verifier", returnTo: "/admin"},
      new Date(2_000_000).toISOString(),
      new Date(1_000_000).toISOString(),
    );
    const first = store.takePendingOAuth("state-1", new Date(1_500_000).toISOString());
    const second = store.takePendingOAuth("state-1", new Date(1_500_000).toISOString());
    expect(first).toEqual({
      adminId: "admin-1",
      codeVerifier: "verifier",
      returnTo: "/admin",
    });
    expect(second).toBeNull();
    db.close();
  });

  it("admin login alone does not imply teacher credential", async () => {
    const root = mkdtempSync(join(tmpdir(), "admin-google-session-"));
    writeFileSync(join(root, "index.html"), "<html></html>");
    const dbPath = join(root, "admin.sqlite");
    const config: AdminAuthConfig = {
      clientId: "test-client.apps.googleusercontent.com",
      allowlist: new Set(["teacher@school.example"]),
      cookieSecure: false,
      verifyGoogleIdToken: async () =>
        claims("teacher@school.example", "google-sub-1"),
    };
    const sessions = createMemoryAdminSessionStore();
    const db = openAdminDb(dbPath);
    process.env.SYNCRATCH_ADMIN_GOOGLE_ACTIVE_KEY_ID = "test-key";
    process.env.SYNCRATCH_ADMIN_GOOGLE_KEYS_JSON = JSON.stringify({
      "test-key": Buffer.alloc(32, 7).toString("base64"),
    });
    process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    handle = await startCollabHost({
      host: "127.0.0.1",
      port: 0,
      staticRoot: root,
      admin: {
        db,
        config,
        sessions,
        classroomFlags: {
          classroomRosterEnabled: true,
          adminGoogleCredentialEnabled: true,
        },
        adminGoogleOAuthEnabled: true,
      },
    });

    const cookieJar = {cookie: "", csrfToken: ""};
    await loginAdmin(handle.url, cookieJar, config);

    const sessionRes = await fetch(
      new URL(ADMIN_GOOGLE_OAUTH_SESSION_PATH, handle.url),
      {headers: {cookie: cookieJar.cookie}},
    );
    expect(sessionRes.status).toBe(200);
    expect(await sessionRes.json()).toMatchObject({
      ok: true,
      connected: false,
    });
    delete process.env.SYNCRATCH_ADMIN_GOOGLE_ACTIVE_KEY_ID;
    delete process.env.SYNCRATCH_ADMIN_GOOGLE_KEYS_JSON;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });
});

describe("admin google oauth via collab-host", () => {
  afterEach(() => {
    delete process.env.SYNCRATCH_ADMIN_GOOGLE_ACTIVE_KEY_ID;
    delete process.env.SYNCRATCH_ADMIN_GOOGLE_KEYS_JSON;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it("registers routes only when flags are OFF", async () => {
    const root = mkdtempSync(join(tmpdir(), "admin-google-flag-off-"));
    writeFileSync(join(root, "index.html"), "<html></html>");
    const db = openAdminDb(join(root, "admin.sqlite"));
    handle = await startCollabHost({
      host: "127.0.0.1",
      port: 0,
      staticRoot: root,
      admin: {db, config: null, adminGoogleOAuthEnabled: false},
    });
    const response = await fetch(
      new URL(ADMIN_GOOGLE_OAUTH_SESSION_PATH, handle.url),
    );
    expect(response.status).toBe(404);
  });

  it("disconnect clears stored credential with CSRF", async () => {
    const root = mkdtempSync(join(tmpdir(), "admin-google-disconnect-"));
    writeFileSync(join(root, "index.html"), "<html></html>");
    const dbPath = join(root, "admin.sqlite");
    const config: AdminAuthConfig = {
      clientId: "test-client.apps.googleusercontent.com",
      allowlist: new Set(["teacher@school.example"]),
      cookieSecure: false,
      verifyGoogleIdToken: async () =>
        claims("teacher@school.example", "google-sub-1"),
    };
    const sessions = createMemoryAdminSessionStore();
    const db = openAdminDb(dbPath);
    const admin = db.upsertAdminFromLogin({
      subject: "google-sub-1",
      email: "teacher@school.example",
      displayName: null,
    });
    const store = createAdminGoogleCredentialStore(
      db.sqlite,
      testAdminGoogleCryptoKeys(),
    );
    store.upsertCredential({
      adminId: admin.adminId,
      googleSubject: "google-sub",
      googleEmail: admin.email,
      scope: DRIVE_FILE_SCOPE,
      refreshToken: "refresh-1",
      nowIso: new Date().toISOString(),
    });

    process.env.SYNCRATCH_ADMIN_GOOGLE_ACTIVE_KEY_ID = "test-key";
    process.env.SYNCRATCH_ADMIN_GOOGLE_KEYS_JSON = JSON.stringify({
      "test-key": Buffer.alloc(32, 7).toString("base64"),
    });
    process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "secret";

    handle = await startCollabHost({
      host: "127.0.0.1",
      port: 0,
      staticRoot: root,
      admin: {
        db,
        config,
        sessions,
        classroomFlags: {
          classroomRosterEnabled: true,
          adminGoogleCredentialEnabled: true,
        },
        adminGoogleOAuthEnabled: true,
      },
    });

    const cookieJar = {cookie: "", csrfToken: ""};
    await loginAdmin(handle.url, cookieJar, config);

    const disconnect = await fetch(
      new URL(ADMIN_GOOGLE_OAUTH_DISCONNECT_PATH, handle.url),
      {
        method: "POST",
        headers: {
          cookie: cookieJar.cookie,
          "x-csrf-token": cookieJar.csrfToken,
        },
      },
    );
    expect(disconnect.status).toBe(200);
    expect(
      db.sqlite
        .prepare(`SELECT COUNT(*) AS c FROM admin_google_credentials`)
        .get() as {c: number},
    ).toEqual({c: 0});
  });

  it("session response omits credentialId when connected", async () => {
    const root = mkdtempSync(join(tmpdir(), "admin-google-session-fields-"));
    writeFileSync(join(root, "index.html"), "<html></html>");
    const dbPath = join(root, "admin.sqlite");
    const config: AdminAuthConfig = {
      clientId: "test-client.apps.googleusercontent.com",
      allowlist: new Set(["teacher@school.example"]),
      cookieSecure: false,
      verifyGoogleIdToken: async () =>
        claims("teacher@school.example", "google-sub-1"),
    };
    const sessions = createMemoryAdminSessionStore();
    const db = openAdminDb(dbPath);
    const admin = db.upsertAdminFromLogin({
      subject: "google-sub-1",
      email: "teacher@school.example",
      displayName: null,
    });
    createAdminGoogleCredentialStore(db.sqlite, testAdminGoogleCryptoKeys()).upsertCredential({
      adminId: admin.adminId,
      googleSubject: "google-sub",
      googleEmail: admin.email,
      scope: DRIVE_FILE_SCOPE,
      refreshToken: "refresh-1",
      nowIso: new Date().toISOString(),
    });

    process.env.SYNCRATCH_ADMIN_GOOGLE_ACTIVE_KEY_ID = "test-key";
    process.env.SYNCRATCH_ADMIN_GOOGLE_KEYS_JSON = JSON.stringify({
      "test-key": Buffer.alloc(32, 7).toString("base64"),
    });
    process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "secret";

    handle = await startCollabHost({
      host: "127.0.0.1",
      port: 0,
      staticRoot: root,
      admin: {
        db,
        config,
        sessions,
        classroomFlags: {
          classroomRosterEnabled: true,
          adminGoogleCredentialEnabled: true,
        },
        adminGoogleOAuthEnabled: true,
      },
    });

    const cookieJar = {cookie: "", csrfToken: ""};
    await loginAdmin(handle.url, cookieJar, config);

    const sessionRes = await fetch(
      new URL(ADMIN_GOOGLE_OAUTH_SESSION_PATH, handle.url),
      {headers: {cookie: cookieJar.cookie}},
    );
    expect(sessionRes.status).toBe(200);
    const body = (await sessionRes.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      connected: true,
      googleEmail: admin.email,
      scope: DRIVE_FILE_SCOPE,
    });
    expect(body).not.toHaveProperty("credentialId");
  });
});
