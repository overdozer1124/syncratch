import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import Database from "better-sqlite3";
import {afterEach, describe, expect, it} from "vitest";
import {
  ADMIN_AUTH_GOOGLE_PATH,
  ADMIN_ME_PATH,
  ADMIN_POLICIES_PATH,
  STUDENT_GRANT_PATH,
  STUDENT_POLICY_PATH,
  STUDENT_POLICY_BY_TOKEN_PREFIX,
  studentPolicyByTokenPath,
} from "@blocksync/classroom-access";
import {startCollabHost, type CollabHostHandle} from "./server.js";
import {
  ADMIN_SESSION_COOKIE,
  createMemoryAdminSessionStore,
  type AdminAuthConfig,
} from "./admin-auth.js";
import {STUDENT_GRANT_COOKIE} from "./student-grant.js";
import {openAdminDb} from "./admin-db.js";

let handle: CollabHostHandle | undefined;

afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

function cookieJar(response: Response): {cookie: string; csrfToken: string} {
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
  expect(parts.some(p => p.startsWith(`${ADMIN_SESSION_COOKIE}=`))).toBe(true);
  return {cookie: parts.join("; "), csrfToken};
}

function readGrantCookie(response: Response): string {
  const setCookies = response.headers.getSetCookie?.() ?? [];
  for (const raw of setCookies) {
    const pair = raw.split(";")[0] ?? "";
    if (pair.startsWith(`${STUDENT_GRANT_COOKIE}=`)) {
      return decodeURIComponent(pair.slice(`${STUDENT_GRANT_COOKIE}=`.length));
    }
  }
  throw new Error("grant cookie missing");
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

async function boot(config: AdminAuthConfig, dbPath: string, root: string) {
  const sessions = createMemoryAdminSessionStore();
  const db = openAdminDb(dbPath);
  handle = await startCollabHost({
    host: "127.0.0.1",
    port: 0,
    staticRoot: root,
    admin: {db, config, sessions},
  });
  return handle;
}

describe("admin / student classroom API", () => {
  it("rejects non-allowlisted accounts", async () => {
    const root = mkdtempSync(join(tmpdir(), "collab-host-admin-deny-"));
    writeFileSync(join(root, "index.html"), "<html>host</html>");
    const dbPath = join(root, "admin.sqlite");
    const h = await boot(
      {
        clientId: "test-client.apps.googleusercontent.com",
        allowlist: new Set(["teacher@school.example"]),
        cookieSecure: false,
        verifyGoogleIdToken: async () =>
          claims("outsider@school.example", "google-sub-2"),
      },
      dbPath,
      root,
    );
    const forbidden = await fetch(new URL(ADMIN_AUTH_GOOGLE_PATH, h.url), {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({idToken: "tok"}),
    });
    expect(forbidden.status).toBe(403);
  });

  it("allowlists admins, issues student links, and locks revoked tokens", async () => {
    const root = mkdtempSync(join(tmpdir(), "collab-host-admin-"));
    writeFileSync(join(root, "index.html"), "<html>host</html>");
    const dbPath = join(root, "admin.sqlite");

    const config: AdminAuthConfig = {
      clientId: "test-client.apps.googleusercontent.com",
      allowlist: new Set(["teacher@school.example"]),
      cookieSecure: false,
      verifyGoogleIdToken: async () =>
        claims("teacher@school.example", "google-sub-1"),
    };

    const h = await boot(config, dbPath, root);
    const login = await fetch(new URL(ADMIN_AUTH_GOOGLE_PATH, h.url), {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({idToken: "tok"}),
    });
    expect(login.status).toBe(200);
    const {cookie, csrfToken} = cookieJar(login);
    expect(csrfToken).toBeTruthy();

    const me = await fetch(new URL(ADMIN_ME_PATH, h.url), {
      headers: {cookie},
    });
    expect(me.status).toBe(200);

    const created = await fetch(new URL(ADMIN_POLICIES_PATH, h.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        title: "3年A組",
        aiAssist: {enabled: false, allowStudentApiKey: false},
        editor: {showSettingsPanel: false},
      }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {
      policy: {policyId: string};
    };

    const linkRes = await fetch(
      new URL(
        `${ADMIN_POLICIES_PATH}/${createdBody.policy.policyId}/links`,
        h.url,
      ),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({label: "5/12"}),
      },
    );
    expect(linkRes.status).toBe(201);
    const linkBody = (await linkRes.json()) as {
      link: {linkId: string; token: string; studentUrl: string};
    };
    expect(linkBody.link.token.length).toBeGreaterThanOrEqual(22);
    expect(linkBody.link.studentUrl).toContain(`/s/${linkBody.link.token}`);

    const student = await fetch(
      new URL(studentPolicyByTokenPath(linkBody.link.token), h.url),
    );
    expect(student.status).toBe(200);
    const studentBody = (await student.json()) as {
      policy: Record<string, unknown>;
    };
    expect(studentBody.policy).toMatchObject({
      aiAssist: {enabled: false, allowStudentApiKey: false},
      editor: {showSettingsPanel: false},
    });
    expect(studentBody.policy).not.toHaveProperty("ownerAdminId");
    expect(JSON.stringify(studentBody)).not.toContain("teacher@");
    expect(JSON.stringify(studentBody)).not.toContain(linkBody.link.token);

    const revoke = await fetch(
      new URL(`/api/admin/links/${linkBody.link.linkId}/revoke`, h.url),
      {
        method: "POST",
        headers: {cookie, "x-csrf-token": csrfToken},
      },
    );
    expect(revoke.status).toBe(200);

    const after = await fetch(
      new URL(studentPolicyByTokenPath(linkBody.link.token), h.url),
    );
    expect(after.status).toBe(404);
  });

  it("exchanges grant, serves policy without token, and rejects after revoke", async () => {
    const root = mkdtempSync(join(tmpdir(), "collab-host-grant-"));
    writeFileSync(join(root, "index.html"), "<html>host</html>");
    const dbPath = join(root, "admin.sqlite");
    const config: AdminAuthConfig = {
      clientId: "test-client.apps.googleusercontent.com",
      allowlist: new Set(["teacher@school.example"]),
      cookieSecure: false,
      verifyGoogleIdToken: async () =>
        claims("teacher@school.example", "google-sub-grant"),
    };
    const h = await boot(config, dbPath, root);

    const login = await fetch(new URL(ADMIN_AUTH_GOOGLE_PATH, h.url), {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({idToken: "tok"}),
    });
    const {cookie, csrfToken} = cookieJar(login);

    const created = await fetch(new URL(ADMIN_POLICIES_PATH, h.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({title: "grant class"}),
    });
    const createdBody = (await created.json()) as {policy: {policyId: string}};

    const linkRes = await fetch(
      new URL(
        `${ADMIN_POLICIES_PATH}/${createdBody.policy.policyId}/links`,
        h.url,
      ),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({label: "grant test"}),
      },
    );
    const linkBody = (await linkRes.json()) as {
      link: {linkId: string; token: string};
    };

    const grantRes = await fetch(new URL(STUDENT_GRANT_PATH, h.url), {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({token: linkBody.link.token}),
    });
    expect(grantRes.status).toBe(200);
    const grantId = readGrantCookie(grantRes);
    expect(grantId.length).toBeGreaterThan(10);
    expect(JSON.stringify(await grantRes.json())).not.toContain(linkBody.link.token);

    const policyRes = await fetch(new URL(STUDENT_POLICY_PATH, h.url), {
      headers: {cookie: `${STUDENT_GRANT_COOKIE}=${encodeURIComponent(grantId)}`},
    });
    expect(policyRes.status).toBe(200);
    const policyBody = (await policyRes.json()) as {policy: {policyId: string}};
    expect(policyBody.policy.policyId).toBe(createdBody.policy.policyId);

    const revoke = await fetch(
      new URL(`/api/admin/links/${linkBody.link.linkId}/revoke`, h.url),
      {method: "POST", headers: {cookie, "x-csrf-token": csrfToken}},
    );
    expect(revoke.status).toBe(200);

    const denied = await fetch(new URL(STUDENT_POLICY_PATH, h.url), {
      headers: {cookie: `${STUDENT_GRANT_COOKIE}=${encodeURIComponent(grantId)}`},
    });
    expect(denied.status).toBe(404);
  });

  it("rejects invalid and past link expiry on create", async () => {
    const root = mkdtempSync(join(tmpdir(), "collab-host-expiry-"));
    writeFileSync(join(root, "index.html"), "<html>host</html>");
    const dbPath = join(root, "admin.sqlite");
    const config: AdminAuthConfig = {
      clientId: "test-client.apps.googleusercontent.com",
      allowlist: new Set(["teacher@school.example"]),
      cookieSecure: false,
      verifyGoogleIdToken: async () =>
        claims("teacher@school.example", "google-sub-exp"),
    };
    const h = await boot(config, dbPath, root);
    const login = await fetch(new URL(ADMIN_AUTH_GOOGLE_PATH, h.url), {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({idToken: "tok"}),
    });
    const {cookie, csrfToken} = cookieJar(login);
    const created = await fetch(new URL(ADMIN_POLICIES_PATH, h.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({title: "expiry class"}),
    });
    const createdBody = (await created.json()) as {policy: {policyId: string}};

    const bad = await fetch(
      new URL(
        `${ADMIN_POLICIES_PATH}/${createdBody.policy.policyId}/links`,
        h.url,
      ),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({label: "bad", expiresAt: "not-a-date"}),
      },
    );
    expect(bad.status).toBe(400);

    const past = await fetch(
      new URL(
        `${ADMIN_POLICIES_PATH}/${createdBody.policy.policyId}/links`,
        h.url,
      ),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({
          label: "past",
          expiresAt: "2020-01-01T00:00:00.000Z",
        }),
      },
    );
    expect(past.status).toBe(400);
  });

  it("reissues expired links with new expiry and rejects old tokens", async () => {
    const root = mkdtempSync(join(tmpdir(), "collab-host-reissue-"));
    writeFileSync(join(root, "index.html"), "<html>host</html>");
    const dbPath = join(root, "admin.sqlite");
    const config: AdminAuthConfig = {
      clientId: "test-client.apps.googleusercontent.com",
      allowlist: new Set(["teacher@school.example"]),
      cookieSecure: false,
      verifyGoogleIdToken: async () =>
        claims("teacher@school.example", "google-sub-reissue"),
    };
    const h = await boot(config, dbPath, root);
    const login = await fetch(new URL(ADMIN_AUTH_GOOGLE_PATH, h.url), {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({idToken: "tok"}),
    });
    const {cookie, csrfToken} = cookieJar(login);
    const created = await fetch(new URL(ADMIN_POLICIES_PATH, h.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({title: "reissue class"}),
    });
    const createdBody = (await created.json()) as {policy: {policyId: string}};

    const linkRes = await fetch(
      new URL(
        `${ADMIN_POLICIES_PATH}/${createdBody.policy.policyId}/links`,
        h.url,
      ),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({label: "expired soon"}),
      },
    );
    const linkBody = (await linkRes.json()) as {
      link: {linkId: string; token: string};
    };
    const oldToken = linkBody.link.token;

    const sqlite = new Database(dbPath);
    sqlite
      .prepare(`UPDATE student_links SET expires_at = ? WHERE link_id = ?`)
      .run("2020-01-01T00:00:00.000Z", linkBody.link.linkId);
    sqlite.close();

    const expiredGrant = await fetch(new URL(STUDENT_GRANT_PATH, h.url), {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({token: oldToken}),
    });
    expect(expiredGrant.status).toBe(404);

    const reissueRes = await fetch(
      new URL(`/api/admin/links/${linkBody.link.linkId}/reissue`, h.url),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({expiresAt: "2030-06-01T00:00:00.000Z"}),
      },
    );
    expect(reissueRes.status).toBe(200);
    const reissueBody = (await reissueRes.json()) as {
      link: {linkId: string; token: string; expiresAt: string | null};
    };
    expect(reissueBody.link.expiresAt).toBe("2030-06-01T00:00:00.000Z");
    expect(reissueBody.link.token).not.toBe(oldToken);

    const newGrant = await fetch(new URL(STUDENT_GRANT_PATH, h.url), {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({token: reissueBody.link.token}),
    });
    expect(newGrant.status).toBe(200);

    const oldAfterReissue = await fetch(new URL(STUDENT_GRANT_PATH, h.url), {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({token: oldToken}),
    });
    expect(oldAfterReissue.status).toBe(404);

    const badReissuePast = await fetch(
      new URL(`/api/admin/links/${reissueBody.link.linkId}/reissue`, h.url),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({expiresAt: "2020-01-01T00:00:00.000Z"}),
      },
    );
    expect(badReissuePast.status).toBe(400);
  });

  it("migrates Phase 1 DB with allowExtensions default true", () => {
    const root = mkdtempSync(join(tmpdir(), "collab-host-phase1-db-"));
    const dbPath = join(root, "legacy.sqlite");
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE admin_accounts (
        admin_id TEXT PRIMARY KEY,
        subject TEXT NOT NULL UNIQUE,
        email TEXT NOT NULL,
        display_name TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE classroom_policies (
        policy_id TEXT PRIMARY KEY,
        owner_admin_id TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        ai_enabled INTEGER NOT NULL,
        ai_level INTEGER NOT NULL,
        ai_allow_student_api_key INTEGER NOT NULL,
        editor_show_settings INTEGER NOT NULL,
        editor_allow_sb3_export INTEGER NOT NULL,
        editor_allow_sb3_import INTEGER NOT NULL,
        collab_allow INTEGER NOT NULL,
        drive_allow INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE student_links (
        link_id TEXT PRIMARY KEY,
        policy_id TEXT NOT NULL,
        owner_admin_id TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        status TEXT NOT NULL,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        revoked_at TEXT
      );
      INSERT INTO admin_accounts VALUES (
        'a1','sub','teacher@school.example',NULL,'active','t0','t0'
      );
      INSERT INTO classroom_policies VALUES (
        'p1','a1','legacy', 'active', 0, 2, 0, 0, 1, 1, 1, 0, 't0','t0'
      );
      INSERT INTO student_links VALUES (
        'l1','p1','a1','abcdefghijklmnopqrstuvwxyz12','memo','active',NULL,'t0',NULL
      );
    `);
    legacy.close();

    const db = openAdminDb(dbPath);
    const view = db.resolveStudentPolicy("abcdefghijklmnopqrstuvwxyz12");
    expect(view?.editor.allowExtensions).toBe(true);
    db.close();
  });
});
