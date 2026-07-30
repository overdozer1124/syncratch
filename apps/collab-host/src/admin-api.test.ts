import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, describe, expect, it} from "vitest";
import {
  ADMIN_AUTH_GOOGLE_PATH,
  ADMIN_ME_PATH,
  ADMIN_POLICIES_PATH,
  studentPolicyByTokenPath,
} from "@blocksync/classroom-access";
import {startCollabHost, type CollabHostHandle} from "./server.js";
import {
  ADMIN_SESSION_COOKIE,
  createMemoryAdminSessionStore,
  type AdminAuthConfig,
} from "./admin-auth.js";
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
});
