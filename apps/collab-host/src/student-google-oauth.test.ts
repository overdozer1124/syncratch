import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import type {IncomingMessage, ServerResponse} from "node:http";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
  STUDENT_AUTH_GOOGLE_CALLBACK_PATH,
  STUDENT_AUTH_GOOGLE_RETURN_FLAG,
  STUDENT_AUTH_GOOGLE_START_PATH,
} from "@blocksync/classroom-access";
import {
  createMemoryAdminSessionStore,
  type AdminAuthConfig,
} from "./admin-auth.js";
import {openAdminDb} from "./admin-db.js";
import {resetClassroomFeatureFlagsCacheForTests} from "./classroom-feature-flags-runtime.js";
import {
  createStudentGoogleOAuthHandler,
  readStudentGoogleOAuthConfigFromEnv,
  type StudentGoogleOAuthConfig,
} from "./student-google-oauth.js";
import {createStudentGoogleOAuthPendingStore} from "./student-google-oauth-pending-store.js";
import {
  buildGoogleIdentityCookieToken,
  loginStudentViaGoogle,
  resolveGrantContext,
  resolveStudentIdentitySession,
  STUDENT_IDENTITY_COOKIE,
} from "./student-auth.js";
import {STUDENT_GRANT_COOKIE} from "./student-grant.js";
import {startCollabHost, type CollabHostHandle} from "./server.js";

let handle: CollabHostHandle | undefined;

beforeEach(() => {
  resetClassroomFeatureFlagsCacheForTests();
  process.env.SYNCRATCH_STUDENT_IDENTITY_SECRET = "test-student-identity-secret";
});

afterEach(async () => {
  await handle?.close();
  handle = undefined;
  delete process.env.SYNCRATCH_STUDENT_IDENTITY_SECRET;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
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

describe("readStudentGoogleOAuthConfigFromEnv", () => {
  it("requires client id and secret", () => {
    expect(readStudentGoogleOAuthConfigFromEnv({})).toBeNull();
    expect(
      readStudentGoogleOAuthConfigFromEnv({
        GOOGLE_CLIENT_ID: "id",
        GOOGLE_CLIENT_SECRET: "secret",
      }),
    ).toMatchObject({clientId: "id", clientSecret: "secret"});
  });
});

describe("student google oauth handler", () => {
  const oauthConfig: StudentGoogleOAuthConfig = {
    clientId: "test-client.apps.googleusercontent.com",
    clientSecret: "secret",
    redirectUri: "http://localhost:8080/oauth/student-google/callback",
    cookieSecure: false,
    now: () => 1_000_000,
    verifyGoogleIdToken: async () =>
      claims("student@school.example", "google-student-sub"),
    fetch: vi.fn(async () => ({
      ok: true,
      json: async () => ({
        id_token: "mock-id-token",
        access_token: "mock-access",
        expires_in: 3600,
        scope: "openid email",
      }),
    })) as unknown as typeof fetch,
  };

  it("returns 404 when feature flag is OFF", async () => {
    const db = openAdminDb(":memory:");
    const store = createStudentGoogleOAuthPendingStore(db.sqlite);
    const handleOAuth = createStudentGoogleOAuthHandler({
      enabled: false,
      db: db.sqlite,
      oauthConfig,
      store,
    });
    const out = mockRes();
    expect(
      await handleOAuth(mockReq(STUDENT_AUTH_GOOGLE_START_PATH), out.res),
    ).toBe(true);
    expect(out.status).toBe(404);
    db.close();
  });

  it("requests openid email scope only at authorize redirect", async () => {
    const db = openAdminDb(":memory:");
    const ts = new Date().toISOString();
    db.sqlite
      .prepare(
        `INSERT INTO admin_accounts (
          admin_id, subject, email, display_name, status, created_at, updated_at
        ) VALUES ('admin-1', 'sub', 'teacher@school.example', NULL, 'active', ?, ?)`,
      )
      .run(ts, ts);
    db.sqlite
      .prepare(
        `INSERT INTO classroom_policies (
          policy_id, owner_admin_id, title, status, roster_id,
          submission_drive_folder_id, student_auth_required,
          student_auth_method, student_auth_allowed_domains_json,
          submission_enabled, ai_enabled, ai_level, ai_allow_student_api_key,
          editor_show_settings, editor_allow_sb3_export, editor_allow_sb3_import,
          editor_allow_extensions, collab_allow, drive_allow, created_at, updated_at
        ) VALUES (
          'p1', 'admin-1', 'class', 'active', 'r1', NULL, 1,
          'google', '[]', 0, 0, 2, 0, 0, 1, 1, 1, 1, 0, ?, ?
        )`,
      )
      .run(ts, ts);
    db.sqlite
      .prepare(
        `INSERT INTO classroom_rosters (
          roster_id, owner_admin_id, title, sheet_spreadsheet_id, sheet_tab_name,
          sheet_range, sync_status, roster_revision, created_at, updated_at
        ) VALUES ('r1', 'admin-1', 'roster', NULL, NULL, NULL, 'active', 0, ?, ?)`,
      )
      .run(ts, ts);
    db.sqlite
      .prepare(
        `INSERT INTO student_links (
          link_id, policy_id, owner_admin_id, token, label, status,
          expires_at, created_at, revoked_at
        ) VALUES ('l1', 'p1', 'admin-1', 'tokentokentokentokentokentok', 'link', 'active', NULL, ?, NULL)`,
      )
      .run(ts);
    db.sqlite
      .prepare(
        `INSERT INTO student_grants (grant_id, link_id, expires_at, created_at)
         VALUES ('g1', 'l1', ?, ?)`,
      )
      .run(new Date(Date.now() + 3600_000).toISOString(), ts);

    const store = createStudentGoogleOAuthPendingStore(db.sqlite);
    const handleOAuth = createStudentGoogleOAuthHandler({
      enabled: true,
      db: db.sqlite,
      oauthConfig,
      store,
      identitySigningSecret: "test-student-identity-secret",
    });
    const out = mockRes();
    await handleOAuth(
      mockReq(`${STUDENT_AUTH_GOOGLE_START_PATH}?return=/s/test`, {
        headers: {
          host: "localhost:8080",
          cookie: `${STUDENT_GRANT_COOKIE}=${encodeURIComponent("g1")}`,
        },
      }),
      out.res,
    );
    expect(out.status).toBe(302);
    const location = String(out.headers.get("location"));
    expect(location).toContain("scope=openid+email");
    expect(location).not.toContain("drive.file");
    db.close();
  });

  it("completes callback and sets identity cookie", async () => {
    const db = openAdminDb(":memory:");
    const ts = new Date().toISOString();
    db.sqlite
      .prepare(
        `INSERT INTO admin_accounts (
          admin_id, subject, email, display_name, status, created_at, updated_at
        ) VALUES ('admin-1', 'sub', 'teacher@school.example', NULL, 'active', ?, ?)`,
      )
      .run(ts, ts);
    db.sqlite
      .prepare(
        `INSERT INTO classroom_policies (
          policy_id, owner_admin_id, title, status, roster_id,
          submission_drive_folder_id, student_auth_required,
          student_auth_method, student_auth_allowed_domains_json,
          submission_enabled, ai_enabled, ai_level, ai_allow_student_api_key,
          editor_show_settings, editor_allow_sb3_export, editor_allow_sb3_import,
          editor_allow_extensions, collab_allow, drive_allow, created_at, updated_at
        ) VALUES (
          'p1', 'admin-1', 'class', 'active', 'r1', NULL, 1,
          'google', '["school.example"]', 0, 0, 2, 0, 0, 1, 1, 1, 1, 0, ?, ?
        )`,
      )
      .run(ts, ts);
    db.sqlite
      .prepare(
        `INSERT INTO classroom_rosters (
          roster_id, owner_admin_id, title, sheet_spreadsheet_id, sheet_tab_name,
          sheet_range, sync_status, roster_revision, created_at, updated_at
        ) VALUES ('r1', 'admin-1', 'roster', NULL, NULL, NULL, 'active', 0, ?, ?)`,
      )
      .run(ts, ts);
    db.sqlite
      .prepare(
        `INSERT INTO student_links (
          link_id, policy_id, owner_admin_id, token, label, status,
          expires_at, created_at, revoked_at
        ) VALUES ('l1', 'p1', 'admin-1', 'tokentokentokentokentokentok', 'link', 'active', NULL, ?, NULL)`,
      )
      .run(ts);
    db.sqlite
      .prepare(
        `INSERT INTO student_grants (grant_id, link_id, expires_at, created_at)
         VALUES ('g1', 'l1', ?, ?)`,
      )
      .run(new Date(Date.now() + 3600_000).toISOString(), ts);
    db.sqlite
      .prepare(
        `INSERT INTO classroom_students (
          student_id, owner_admin_id, student_code, display_name,
          attendance_number, login_name, group_label, google_email, google_subject,
          active, archived_at, created_at, updated_at
        ) VALUES ('s1', 'admin-1', 'G001', 'Google Student', '01', 'google.student', NULL, ?, NULL, 1, NULL, ?, ?)`,
      )
      .run("student@school.example", ts, ts);
    db.sqlite
      .prepare(
        `INSERT INTO classroom_roster_memberships (
          membership_id, roster_id, student_id, active, created_at, updated_at
        ) VALUES ('m1', 'r1', 's1', 1, ?, ?)`,
      )
      .run(ts, ts);

    const store = createStudentGoogleOAuthPendingStore(db.sqlite);
    store.putPendingOAuth(
      "oauth-state-1",
      {grantId: "g1", codeVerifier: "verifier-1", returnTo: "/"},
      new Date(Date.now() + 600_000).toISOString(),
      ts,
    );

    const mockFetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        id_token: "mock-id-token",
        access_token: "mock-access",
        expires_in: 3600,
        scope: "openid email",
      }),
    }));

    const handleOAuth = createStudentGoogleOAuthHandler({
      enabled: true,
      db: db.sqlite,
      oauthConfig: {
        ...oauthConfig,
        fetch: mockFetch as unknown as typeof fetch,
      },
      store,
      identitySigningSecret: "test-student-identity-secret",
    });
    const out = mockRes();
    await handleOAuth(
      mockReq(
        `${STUDENT_AUTH_GOOGLE_CALLBACK_PATH}?code=auth-code&state=oauth-state-1`,
      ),
      out.res,
    );
    expect(out.status).toBe(302);
    const location = String(out.headers.get("location"));
    expect(location).toContain(`${STUDENT_AUTH_GOOGLE_RETURN_FLAG}=ok`);
    const setCookie = out.headers.get("set-cookie");
    expect(String(setCookie)).toContain(`${STUDENT_IDENTITY_COOKIE}=`);
    db.close();
  });
});

describe("loginStudentViaGoogle", () => {
  it("binds google_subject and rejects roster mismatch", () => {
    const db = openAdminDb(":memory:");
    const ts = new Date().toISOString();
    db.sqlite
      .prepare(
        `INSERT INTO admin_accounts (
          admin_id, subject, email, display_name, status, created_at, updated_at
        ) VALUES ('admin-1', 'sub', 'teacher@school.example', NULL, 'active', ?, ?)`,
      )
      .run(ts, ts);
    db.sqlite
      .prepare(
        `INSERT INTO classroom_policies (
          policy_id, owner_admin_id, title, status, roster_id,
          submission_drive_folder_id, student_auth_required,
          student_auth_method, student_auth_allowed_domains_json,
          submission_enabled, ai_enabled, ai_level, ai_allow_student_api_key,
          editor_show_settings, editor_allow_sb3_export, editor_allow_sb3_import,
          editor_allow_extensions, collab_allow, drive_allow, created_at, updated_at
        ) VALUES (
          'p1', 'admin-1', 'class', 'active', 'r1', NULL, 1,
          'google', '["school.example"]', 0, 0, 2, 0, 0, 1, 1, 1, 1, 0, ?, ?
        )`,
      )
      .run(ts, ts);
    db.sqlite
      .prepare(
        `INSERT INTO classroom_rosters (
          roster_id, owner_admin_id, title, sheet_spreadsheet_id, sheet_tab_name,
          sheet_range, sync_status, roster_revision, created_at, updated_at
        ) VALUES ('r1', 'admin-1', 'roster', NULL, NULL, NULL, 'active', 0, ?, ?)`,
      )
      .run(ts, ts);
    db.sqlite
      .prepare(
        `INSERT INTO student_links (
          link_id, policy_id, owner_admin_id, token, label, status,
          expires_at, created_at, revoked_at
        ) VALUES ('l1', 'p1', 'admin-1', 'tokentokentokentokentokentok', 'link', 'active', NULL, ?, NULL)`,
      )
      .run(ts);
    db.sqlite
      .prepare(
        `INSERT INTO student_grants (grant_id, link_id, expires_at, created_at)
         VALUES ('g1', 'l1', ?, ?)`,
      )
      .run(new Date(Date.now() + 3600_000).toISOString(), ts);
    db.sqlite
      .prepare(
        `INSERT INTO classroom_students (
          student_id, owner_admin_id, student_code, display_name,
          attendance_number, login_name, group_label, google_email, google_subject,
          active, archived_at, created_at, updated_at
        ) VALUES ('s1', 'admin-1', 'S1', 'Student', '01', 'student.one', NULL, ?, NULL, 1, NULL, ?, ?)`,
      )
      .run("student@school.example", ts, ts);
    db.sqlite
      .prepare(
        `INSERT INTO classroom_roster_memberships (
          membership_id, roster_id, student_id, active, created_at, updated_at
        ) VALUES ('m1', 'r1', 's1', 1, ?, ?)`,
      )
      .run(ts, ts);

    const grant = resolveGrantContext(db.sqlite, "g1")!;
    const success = loginStudentViaGoogle(db.sqlite, {
      grant,
      googleSubject: "sub-123",
      googleEmail: "student@school.example",
      emailVerified: true,
      authPolicy: {method: "google", allowedEmailDomains: ["school.example"]},
    });
    expect(success.ok).toBe(true);
    if (!success.ok) return;

    const row = db.sqlite
      .prepare(`SELECT google_subject FROM classroom_students WHERE student_id = 's1'`)
      .get() as {google_subject: string};
    expect(row.google_subject).toBe("sub-123");

    const token = buildGoogleIdentityCookieToken(success, "test-student-identity-secret");
    const session = resolveStudentIdentitySession(db.sqlite, {
      grantId: "g1",
      identityToken: token,
      signingSecret: "test-student-identity-secret",
    });
    expect(session?.studentId).toBe("s1");

    const outsider = loginStudentViaGoogle(db.sqlite, {
      grant,
      googleSubject: "sub-other",
      googleEmail: "outsider@gmail.com",
      emailVerified: true,
      authPolicy: {method: "google", allowedEmailDomains: ["school.example"]},
    });
    expect(outsider.ok).toBe(false);
    db.close();
  });
});

describe("student google oauth integration", () => {
  it("returns 404 when rosterGoogleStudentAuthEnabled is off", async () => {
    const root = mkdtempSync(join(tmpdir(), "google-auth-off-"));
    writeFileSync(join(root, "index.html"), "<html></html>");
    const dbPath = join(root, "admin.sqlite");
    const config: AdminAuthConfig = {
      clientId: "test-client.apps.googleusercontent.com",
      allowlist: new Set(["teacher@school.example"]),
      cookieSecure: false,
    };
    handle = await startCollabHost({
      host: "127.0.0.1",
      port: 0,
      staticRoot: root,
      admin: {
        db: openAdminDb(dbPath),
        config,
        sessions: createMemoryAdminSessionStore(),
        classroomRosterEnabled: true,
        studentLocalAuthEnabled: true,
        rosterGoogleStudentAuthEnabled: false,
      },
    });
    const res = await fetch(new URL(STUDENT_AUTH_GOOGLE_START_PATH, handle.url));
    expect(res.status).toBe(404);
  });
});
