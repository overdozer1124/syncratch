import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
  ADMIN_AUTH_GOOGLE_PATH,
  ADMIN_POLICIES_PATH,
  ADMIN_ROSTERS_PATH,
  STUDENT_AUTH_ACTIVATE_PATH,
  STUDENT_AUTH_LOGIN_PATH,
  STUDENT_AUTH_LOGOUT_PATH,
  STUDENT_AUTH_SESSION_PATH,
  STUDENT_GRANT_PATH,
  STUDENT_POLICY_PATH,
  adminPolicyPath,
  adminStudentEnrollmentCodePath,
  adminStudentRevokeSessionsPath,
} from "@blocksync/classroom-access";
import {startCollabHost, type CollabHostHandle} from "./server.js";
import {
  createMemoryAdminSessionStore,
  type AdminAuthConfig,
} from "./admin-auth.js";
import {STUDENT_GRANT_COOKIE} from "./student-grant.js";
import {STUDENT_IDENTITY_COOKIE} from "./student-auth.js";
import {openAdminDb} from "./admin-db.js";
import {resetClassroomFeatureFlagsCacheForTests} from "./classroom-feature-flags-runtime.js";

let handle: CollabHostHandle | undefined;

beforeEach(() => {
  resetClassroomFeatureFlagsCacheForTests();
  process.env.SYNCRATCH_STUDENT_IDENTITY_SECRET = "test-student-identity-secret";
});

afterEach(async () => {
  await handle?.close();
  handle = undefined;
  delete process.env.SYNCRATCH_STUDENT_IDENTITY_SECRET;
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
  return {cookie: parts.join("; "), csrfToken};
}

function readCookie(response: Response, name: string): string {
  const setCookies = response.headers.getSetCookie?.() ?? [];
  for (const raw of setCookies) {
    const pair = raw.split(";")[0] ?? "";
    if (pair.startsWith(`${name}=`)) {
      return decodeURIComponent(pair.slice(`${name}=`.length));
    }
  }
  throw new Error(`${name} cookie missing`);
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

async function bootStudentAuth(root: string, dbPath: string) {
  const config: AdminAuthConfig = {
    clientId: "test-client.apps.googleusercontent.com",
    allowlist: new Set(["teacher@school.example"]),
    cookieSecure: false,
    verifyGoogleIdToken: async () =>
      claims("teacher@school.example", "google-sub-1"),
  };
  const sessions = createMemoryAdminSessionStore();
  const db = openAdminDb(dbPath);
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
        adminGoogleCredentialEnabled: false,
      },
      classroomRosterEnabled: true,
      studentLocalAuthEnabled: true,
    },
  });
  return {handle: handle!, db, config, sessions};
}

async function seedRosterLoginFixture(h: CollabHostHandle, db: ReturnType<typeof openAdminDb>) {
  const login = await fetch(new URL(ADMIN_AUTH_GOOGLE_PATH, h.url), {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({idToken: "tok"}),
  });
  const {cookie, csrfToken} = cookieJar(login);

  const meRes = await fetch(new URL("/api/admin/me", h.url), {headers: {cookie}});
  const meBody = (await meRes.json()) as {admin: {adminId: string}};

  const policyRes = await fetch(new URL(ADMIN_POLICIES_PATH, h.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify({title: "auth class"}),
  });
  const policyBody = (await policyRes.json()) as {policy: {policyId: string}};

  const rosterRes = await fetch(new URL(ADMIN_ROSTERS_PATH, h.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify({title: "2026 A"}),
  });
  const rosterBody = (await rosterRes.json()) as {roster: {rosterId: string}};

  await fetch(new URL(adminPolicyPath(policyBody.policy.policyId), h.url), {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      cookie,
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify({
      rosterId: rosterBody.roster.rosterId,
      studentAuth: {required: true},
    }),
  });

  const ts = new Date().toISOString();
  const studentId = "student-test-1";
  db.sqlite
    .prepare(
      `INSERT INTO classroom_students (
        student_id, owner_admin_id, student_code, display_name,
        attendance_number, login_name, group_label, active,
        archived_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, NULL, ?, ?)`,
    )
    .run(
      studentId,
      meBody.admin.adminId,
      "S001",
      "Student One",
      "01",
      "student.one",
      null,
      ts,
      ts,
    );
  db.sqlite
    .prepare(
      `INSERT INTO classroom_roster_memberships (
        membership_id, roster_id, student_id, active, created_at, updated_at
      ) VALUES (?, ?, ?, 1, ?, ?)`,
    )
    .run("membership-1", rosterBody.roster.rosterId, studentId, ts, ts);

  const linkRes = await fetch(
    new URL(`${ADMIN_POLICIES_PATH}/${policyBody.policy.policyId}/links`, h.url),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({label: "student link"}),
    },
  );
  const linkBody = (await linkRes.json()) as {link: {token: string}};

  const grantRes = await fetch(new URL(STUDENT_GRANT_PATH, h.url), {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({token: linkBody.link.token}),
  });
  const grantId = readCookie(grantRes, STUDENT_GRANT_COOKIE);

  const issueRes = await fetch(
    new URL(adminStudentEnrollmentCodePath(studentId), h.url),
    {
      method: "POST",
      headers: {
        cookie,
        "x-csrf-token": csrfToken,
      },
    },
  );
  const issueBody = (await issueRes.json()) as {
    enrollmentCode: string;
    expiresAt: string;
  };

  return {
    cookie,
    csrfToken,
    studentId,
    rosterId: rosterBody.roster.rosterId,
    ownerAdminId: meBody.admin.adminId,
    grantId,
    enrollmentCode: issueBody.enrollmentCode,
    passphrase: "secret-passphrase",
  };
}

describe("student local auth", () => {
  it("returns 404 when student local auth flag is off", async () => {
    const root = mkdtempSync(join(tmpdir(), "student-auth-off-"));
    writeFileSync(join(root, "index.html"), "<html></html>");
    const dbPath = join(root, "admin.sqlite");
    const config: AdminAuthConfig = {
      clientId: "test-client.apps.googleusercontent.com",
      allowlist: new Set(["teacher@school.example"]),
      cookieSecure: false,
      verifyGoogleIdToken: async () =>
        claims("teacher@school.example", "google-sub-1"),
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
        studentLocalAuthEnabled: false,
      },
    });
    const res = await fetch(new URL(STUDENT_AUTH_SESSION_PATH, handle.url));
    expect(res.status).toBe(404);
  });

  it("activates with enrollment code and logs in with login_name or student_code", async () => {
    const root = mkdtempSync(join(tmpdir(), "student-auth-flow-"));
    writeFileSync(join(root, "index.html"), "<html></html>");
    const dbPath = join(root, "admin.sqlite");
    const {handle: h} = await bootStudentAuth(root, dbPath);
    const fixture = await seedRosterLoginFixture(h, openAdminDb(dbPath));

    const grantCookie = `${STUDENT_GRANT_COOKIE}=${encodeURIComponent(fixture.grantId)}`;

    const badActivate = await fetch(new URL(STUDENT_AUTH_ACTIVATE_PATH, h.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: grantCookie,
      },
      body: JSON.stringify({
        enrollmentCode: "BADCODE1",
        passphrase: fixture.passphrase,
      }),
    });
    expect(badActivate.status).toBe(401);

    const activate = await fetch(new URL(STUDENT_AUTH_ACTIVATE_PATH, h.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: grantCookie,
      },
      body: JSON.stringify({
        enrollmentCode: fixture.enrollmentCode,
        passphrase: fixture.passphrase,
      }),
    });
    expect(activate.status).toBe(200);
    const identityToken = readCookie(activate, STUDENT_IDENTITY_COOKIE);
    const activateBody = (await activate.json()) as {studentId: string};
    expect(activateBody.studentId).toBe(fixture.studentId);

    const session = await fetch(new URL(STUDENT_AUTH_SESSION_PATH, h.url), {
      headers: {
        cookie: `${grantCookie}; ${STUDENT_IDENTITY_COOKIE}=${encodeURIComponent(identityToken)}`,
      },
    });
    expect(session.status).toBe(200);
    const sessionBody = (await session.json()) as {authenticated: boolean; studentId: string};
    expect(sessionBody.authenticated).toBe(true);
    expect(sessionBody.studentId).toBe(fixture.studentId);

    await fetch(new URL(STUDENT_AUTH_LOGOUT_PATH, h.url), {
      method: "POST",
      headers: {cookie: grantCookie},
    });

    const loginByName = await fetch(new URL(STUDENT_AUTH_LOGIN_PATH, h.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: grantCookie,
      },
      body: JSON.stringify({
        loginName: "student.one",
        passphrase: fixture.passphrase,
      }),
    });
    expect(loginByName.status).toBe(200);

    const loginByCode = await fetch(new URL(STUDENT_AUTH_LOGIN_PATH, h.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: grantCookie,
      },
      body: JSON.stringify({
        loginName: "S001",
        passphrase: fixture.passphrase,
      }),
    });
    expect(loginByCode.status).toBe(200);
  });

  it("requires grant for identity session and rejects roster mismatch", async () => {
    const root = mkdtempSync(join(tmpdir(), "student-auth-grant-"));
    writeFileSync(join(root, "index.html"), "<html></html>");
    const dbPath = join(root, "admin.sqlite");
    const {handle: h, db} = await bootStudentAuth(root, dbPath);
    const fixture = await seedRosterLoginFixture(h, db);

    const noGrant = await fetch(new URL(STUDENT_AUTH_SESSION_PATH, h.url));
    expect(noGrant.status).toBe(401);

    const grantCookie = `${STUDENT_GRANT_COOKIE}=${encodeURIComponent(fixture.grantId)}`;
    const activate = await fetch(new URL(STUDENT_AUTH_ACTIVATE_PATH, h.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: grantCookie,
      },
      body: JSON.stringify({
        enrollmentCode: fixture.enrollmentCode,
        passphrase: fixture.passphrase,
      }),
    });
    const identityToken = readCookie(activate, STUDENT_IDENTITY_COOKIE);

    db.sqlite
      .prepare(
        `UPDATE classroom_roster_memberships SET active = 0 WHERE student_id = ?`,
      )
      .run(fixture.studentId);

    const mismatched = await fetch(new URL(STUDENT_AUTH_SESSION_PATH, h.url), {
      headers: {
        cookie: `${grantCookie}; ${STUDENT_IDENTITY_COOKIE}=${encodeURIComponent(identityToken)}`,
      },
    });
    expect(mismatched.status).toBe(401);
  });

  it("invalidates identity when grant expires", async () => {
    const root = mkdtempSync(join(tmpdir(), "student-auth-expiry-"));
    writeFileSync(join(root, "index.html"), "<html></html>");
    const dbPath = join(root, "admin.sqlite");
    const {handle: h, db} = await bootStudentAuth(root, dbPath);
    const fixture = await seedRosterLoginFixture(h, db);

    const grantCookie = `${STUDENT_GRANT_COOKIE}=${encodeURIComponent(fixture.grantId)}`;
    const activate = await fetch(new URL(STUDENT_AUTH_ACTIVATE_PATH, h.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: grantCookie,
      },
      body: JSON.stringify({
        enrollmentCode: fixture.enrollmentCode,
        passphrase: fixture.passphrase,
      }),
    });
    const identityToken = readCookie(activate, STUDENT_IDENTITY_COOKIE);

    db.sqlite
      .prepare(`UPDATE student_grants SET expires_at = ? WHERE grant_id = ?`)
      .run(new Date(Date.now() - 60_000).toISOString(), fixture.grantId);

    const expired = await fetch(new URL(STUDENT_AUTH_SESSION_PATH, h.url), {
      headers: {
        cookie: `${grantCookie}; ${STUDENT_IDENTITY_COOKIE}=${encodeURIComponent(identityToken)}`,
      },
    });
    expect(expired.status).toBe(401);

    const policyRes = await fetch(new URL(STUDENT_POLICY_PATH, h.url), {
      headers: {cookie: grantCookie},
    });
    expect(policyRes.status).toBe(404);
  });

  it("revokes identity sessions via admin endpoint", async () => {
    const root = mkdtempSync(join(tmpdir(), "student-auth-revoke-"));
    writeFileSync(join(root, "index.html"), "<html></html>");
    const dbPath = join(root, "admin.sqlite");
    const {handle: h} = await bootStudentAuth(root, dbPath);
    const fixture = await seedRosterLoginFixture(h, openAdminDb(dbPath));

    const grantCookie = `${STUDENT_GRANT_COOKIE}=${encodeURIComponent(fixture.grantId)}`;
    const activate = await fetch(new URL(STUDENT_AUTH_ACTIVATE_PATH, h.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: grantCookie,
      },
      body: JSON.stringify({
        enrollmentCode: fixture.enrollmentCode,
        passphrase: fixture.passphrase,
      }),
    });
    const identityToken = readCookie(activate, STUDENT_IDENTITY_COOKIE);

    const revoke = await fetch(
      new URL(adminStudentRevokeSessionsPath(fixture.studentId), h.url),
      {
        method: "POST",
        headers: {
          cookie: fixture.cookie,
          "x-csrf-token": fixture.csrfToken,
        },
      },
    );
    expect(revoke.status).toBe(200);

    const session = await fetch(new URL(STUDENT_AUTH_SESSION_PATH, h.url), {
      headers: {
        cookie: `${grantCookie}; ${STUDENT_IDENTITY_COOKIE}=${encodeURIComponent(identityToken)}`,
      },
    });
    expect(session.status).toBe(401);
  });
});

describe("student-auth crypto helpers", () => {
  it("hashes and verifies secrets with scrypt", async () => {
    const {hashSecret, verifySecret} = await import("./student-auth.js");
    const hash = await hashSecret("test-value");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifySecret("test-value", hash)).toBe(true);
    expect(await verifySecret("wrong", hash)).toBe(false);
  });

  it("signs and parses identity tokens", async () => {
    const {
      createSignedIdentityToken,
      parseSignedIdentityToken,
    } = await import("./student-auth.js");
    const payload = {
      accountId: "acc-1",
      studentId: "stu-1",
      passwordVersion: 2,
      expiresAtMs: Date.now() + 60_000,
    };
    const token = createSignedIdentityToken(payload, "secret");
    expect(parseSignedIdentityToken(token, "secret")).toEqual(payload);
    expect(parseSignedIdentityToken(token, "wrong")).toBeNull();
  });
});
