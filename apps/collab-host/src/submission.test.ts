import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createHash} from "node:crypto";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
  ADMIN_AUTH_GOOGLE_PATH,
  ADMIN_POLICIES_PATH,
  ADMIN_ROSTERS_PATH,
  STUDENT_AUTH_ACTIVATE_PATH,
  STUDENT_GRANT_PATH,
  STUDENT_SUBMISSIONS_PATH,
  adminPolicyPath,
  adminPolicySubmissionsPath,
  adminStudentEnrollmentCodePath,
  adminSubmissionContentPath,
  adminSubmissionPath,
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
import {createAdminGoogleCredentialStore} from "./admin-google-credential-store.js";
import {parseAdminGoogleCryptoKeysFromEnv} from "./admin-token-crypto.js";

let handle: CollabHostHandle | undefined;

beforeEach(() => {
  resetClassroomFeatureFlagsCacheForTests();
  process.env.SYNCRATCH_STUDENT_IDENTITY_SECRET = "test-student-identity-secret";
  process.env.SYNCRATCH_ADMIN_GOOGLE_ACTIVE_KEY_ID = "test-key";
  process.env.SYNCRATCH_ADMIN_GOOGLE_KEYS_JSON = JSON.stringify({
    "test-key": Buffer.alloc(32, 7).toString("base64"),
  });
  process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
  process.env.GOOGLE_CLIENT_SECRET = "secret";
});

afterEach(async () => {
  await handle?.close();
  handle = undefined;
  vi.unstubAllGlobals();
  delete process.env.SYNCRATCH_STUDENT_IDENTITY_SECRET;
  delete process.env.SYNCRATCH_ADMIN_GOOGLE_ACTIVE_KEY_ID;
  delete process.env.SYNCRATCH_ADMIN_GOOGLE_KEYS_JSON;
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
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
  for (const raw of response.headers.getSetCookie?.() ?? []) {
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

function extractDriveUploadFileName(init?: RequestInit): string {
  const body = init?.body;
  if (!body || typeof body === "string") {
    throw new Error("expected binary upload body");
  }
  const text = Buffer.from(body as ArrayBuffer).toString("utf8");
  const match = text.match(/"name":"((?:\\.|[^"\\])*)"/);
  if (!match) {
    throw new Error("Drive upload metadata name missing");
  }
  return JSON.parse(`"${match[1]}"`) as string;
}

function buildMultipartBody(fields: Record<string, string | Buffer>): {
  body: Buffer;
  contentType: string;
} {
  const boundary = "testboundary123";
  const chunks: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"${
          Buffer.isBuffer(value) ? '; filename="submission.sb3"' : ""
        }\r\n\r\n`,
        "utf8",
      ),
    );
    chunks.push(Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8"));
    chunks.push(Buffer.from("\r\n", "utf8"));
  }
  chunks.push(Buffer.from(`--${boundary}--`, "utf8"));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

async function bootSubmissionHost(root: string, dbPath: string) {
  const config: AdminAuthConfig = {
    clientId: "test-client.apps.googleusercontent.com",
    allowlist: new Set(["teacher@school.example"]),
    cookieSecure: false,
    verifyGoogleIdToken: async () =>
      claims("teacher@school.example", "google-sub-1"),
  };
  const sessions = createMemoryAdminSessionStore();
  const db = openAdminDb(dbPath);
  const cryptoKeys = parseAdminGoogleCryptoKeysFromEnv(process.env)!;
  const store = createAdminGoogleCredentialStore(db.sqlite, cryptoKeys);
  store.upsertCredential({
    adminId: db.upsertAdminFromLogin({
      subject: "google-sub-1",
      email: "teacher@school.example",
      displayName: null,
    }).adminId,
    googleSubject: "google-sub-teacher",
    googleEmail: "teacher@school.example",
    scope: "https://www.googleapis.com/auth/drive.file",
    refreshToken: "refresh-token",
    accessToken: "access-token",
    accessExpiresAt: Date.now() + 3600_000,
    nowIso: new Date().toISOString(),
  });

  let uploadCount = 0;
  const originalFetch = globalThis.fetch.bind(globalThis);
  const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (href.includes("upload/drive/v3/files")) {
      uploadCount += 1;
      return new Response(JSON.stringify({id: `drive-file-${uploadCount}`}), {
        status: 200,
        headers: {"content-type": "application/json"},
      });
    }
    if (href.includes("alt=media")) {
      return new Response(Buffer.from("SB3BYTES"), {status: 200});
    }
    if (href.includes("oauth2.googleapis.com/token")) {
      return new Response(JSON.stringify({access_token: "access-token", expires_in: 3600}), {
        status: 200,
        headers: {"content-type": "application/json"},
      });
    }
    return originalFetch(url, init);
  });
  vi.stubGlobal("fetch", fetchMock);

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
        studentLocalAuthEnabled: true,
        teacherDriveSubmissionEnabled: true,
      },
      classroomRosterEnabled: true,
      adminGoogleOAuthEnabled: true,
      studentLocalAuthEnabled: true,
      teacherDriveSubmissionEnabled: true,
    },
  });

  return {handle: handle!, db, config, sessions, fetchMock};
}

async function seedSubmissionFixture(
  h: CollabHostHandle,
  db: ReturnType<typeof openAdminDb>,
) {
  const login = await fetch(new URL(ADMIN_AUTH_GOOGLE_PATH, h.url), {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({idToken: "tok"}),
  });
  const {cookie, csrfToken} = cookieJar(login);
  const meBody = (await (
    await fetch(new URL("/api/admin/me", h.url), {headers: {cookie}})
  ).json()) as {admin: {adminId: string}};

  const policyRes = await fetch(new URL(ADMIN_POLICIES_PATH, h.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify({title: "submit class"}),
  });
  const policyBody = (await policyRes.json()) as {policy: {policyId: string}};

  const rosterRes = await fetch(new URL(ADMIN_ROSTERS_PATH, h.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie,
      "x-csrf-token": csrfToken,
    },
    body: JSON.stringify({title: "2026 B"}),
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
      submission: {enabled: true},
      submissionDriveFolderId: "teacher-folder-1",
    }),
  });

  const ts = new Date().toISOString();
  const studentId = "student-submit-1";
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
      "261101",
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
    .run("membership-submit-1", rosterBody.roster.rosterId, studentId, ts, ts);

  const linkRes = await fetch(
    new URL(`${ADMIN_POLICIES_PATH}/${policyBody.policy.policyId}/links`, h.url),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({label: "submit link"}),
    },
  );
  const linkBody = (await linkRes.json()) as {link: {token: string}};

  const grantRes = await fetch(new URL(STUDENT_GRANT_PATH, h.url), {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({token: linkBody.link.token}),
  });
  const grantId = readCookie(grantRes, STUDENT_GRANT_COOKIE);
  const grantCookie = `${STUDENT_GRANT_COOKIE}=${encodeURIComponent(grantId)}`;

  const issueRes = await fetch(
    new URL(adminStudentEnrollmentCodePath(studentId), h.url),
    {
      method: "POST",
      headers: {cookie, "x-csrf-token": csrfToken},
    },
  );
  const issueBody = (await issueRes.json()) as {enrollmentCode: string};

  const activate = await fetch(new URL(STUDENT_AUTH_ACTIVATE_PATH, h.url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: grantCookie,
    },
    body: JSON.stringify({
      enrollmentCode: issueBody.enrollmentCode,
      passphrase: "secret-passphrase",
    }),
  });
  const identityToken = readCookie(activate, STUDENT_IDENTITY_COOKIE);

  return {
    cookie,
    csrfToken,
    policyId: policyBody.policy.policyId,
    studentId,
    grantCookie,
    identityCookie: `${STUDENT_IDENTITY_COOKIE}=${encodeURIComponent(identityToken)}`,
  };
}

describe("teacher drive submissions", () => {
  it("returns 404 when submission flag is off", async () => {
    const root = mkdtempSync(join(tmpdir(), "submission-off-"));
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
        teacherDriveSubmissionEnabled: false,
      },
    });
    const res = await fetch(new URL(STUDENT_SUBMISSIONS_PATH, handle.url), {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("requires identity and stores metadata without sqlite bytes", async () => {
    const root = mkdtempSync(join(tmpdir(), "submission-flow-"));
    writeFileSync(join(root, "index.html"), "<html></html>");
    const dbPath = join(root, "admin.sqlite");
    const {handle: h, db, fetchMock} = await bootSubmissionHost(root, dbPath);
    const fixture = await seedSubmissionFixture(h, db);

    const noIdentityMultipart = buildMultipartBody({
      projectTitle: "Work",
      idempotencyKey: "key-no-identity",
      sb3: Buffer.from("SB3DATA"),
    });
    const noIdentity = await fetch(new URL(STUDENT_SUBMISSIONS_PATH, h.url), {
      method: "POST",
      headers: {
        cookie: fixture.grantCookie,
        "content-type": noIdentityMultipart.contentType,
      },
      body: new Uint8Array(noIdentityMultipart.body),
    });
    expect(noIdentity.status).toBe(401);

    const sb3 = Buffer.from("SB3DATA");
    const multipart = buildMultipartBody({
      projectTitle: "Work",
      idempotencyKey: "key-1",
      sb3,
    });
    const submit = await fetch(new URL(STUDENT_SUBMISSIONS_PATH, h.url), {
      method: "POST",
      headers: {
        cookie: `${fixture.grantCookie}; ${fixture.identityCookie}`,
        "content-type": multipart.contentType,
      },
      body: new Uint8Array(multipart.body),
    });
    expect(submit.status).toBe(201);
    const submitBody = (await submit.json()) as {
      submission: {submissionId: string; contentSha256: string; isResubmission: boolean};
    };
    expect(submitBody.submission.isResubmission).toBe(false);
    expect(submitBody.submission.contentSha256).toBe(
      createHash("sha256").update(sb3).digest("hex"),
    );

    const row = db.sqlite
      .prepare(`SELECT * FROM classroom_submissions WHERE submission_id = ?`)
      .get(submitBody.submission.submissionId) as Record<string, unknown>;
    expect(row.drive_file_id).toBeTruthy();
    expect(Object.keys(row).join(",")).not.toMatch(/\bsb3\b|content_bytes|submission_bytes/i);

    const duplicate = await fetch(new URL(STUDENT_SUBMISSIONS_PATH, h.url), {
      method: "POST",
      headers: {
        cookie: `${fixture.grantCookie}; ${fixture.identityCookie}`,
        "content-type": multipart.contentType,
      },
      body: new Uint8Array(multipart.body),
    });
    expect(duplicate.status).toBe(200);

    const resubmit = buildMultipartBody({
      projectTitle: "Work v2",
      idempotencyKey: "key-2",
      sb3: Buffer.from("SB3DATA2"),
    });
    const second = await fetch(new URL(STUDENT_SUBMISSIONS_PATH, h.url), {
      method: "POST",
      headers: {
        cookie: `${fixture.grantCookie}; ${fixture.identityCookie}`,
        "content-type": resubmit.contentType,
      },
      body: new Uint8Array(resubmit.body),
    });
    expect(second.status).toBe(201);
    const secondBody = (await second.json()) as {
      submission: {isResubmission: boolean};
    };
    expect(secondBody.submission.isResubmission).toBe(true);

    const uploadCalls = fetchMock.mock.calls.filter(([requestUrl]) =>
      String(requestUrl).includes("upload/drive/v3/files"),
    );
    expect(uploadCalls).toHaveLength(2);
    const firstUploadName = extractDriveUploadFileName(uploadCalls[0]?.[1]);
    const secondUploadName = extractDriveUploadFileName(uploadCalls[1]?.[1]);
    expect(firstUploadName).toMatch(/^261101_Student One_Work_\d{8}-\d{6}\.sb3$/);
    expect(secondUploadName).toMatch(/^261101_Student One_Work v2_\d{8}-\d{6}\.sb3$/);
    expect(firstUploadName).not.toBe(secondUploadName);
  });

  it("deduplicates parallel uploads with the same idempotency key", async () => {
    const root = mkdtempSync(join(tmpdir(), "submission-parallel-"));
    writeFileSync(join(root, "index.html"), "<html></html>");
    const dbPath = join(root, "admin.sqlite");
    const {handle: h, db, fetchMock} = await bootSubmissionHost(root, dbPath);
    const fixture = await seedSubmissionFixture(h, db);

    const multipart = buildMultipartBody({
      projectTitle: "Parallel",
      idempotencyKey: "parallel-key",
      sb3: Buffer.from("PARALLEL-SB3"),
    });
    const headers = {
      cookie: `${fixture.grantCookie}; ${fixture.identityCookie}`,
      "content-type": multipart.contentType,
    };
    const body = new Uint8Array(multipart.body);
    const url = new URL(STUDENT_SUBMISSIONS_PATH, h.url);

    const [first, second] = await Promise.all([
      fetch(url, {method: "POST", headers, body}),
      fetch(url, {method: "POST", headers, body}),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 201]);
    const firstBody = (await first.json()) as {
      submission: {submissionId: string};
    };
    const secondBody = (await second.json()) as {
      submission: {submissionId: string};
    };
    expect(firstBody.submission.submissionId).toBe(
      secondBody.submission.submissionId,
    );
    const uploadCalls = fetchMock.mock.calls.filter(([requestUrl]) =>
      String(requestUrl).includes("upload/drive/v3/files"),
    );
    expect(uploadCalls).toHaveLength(1);
  });

  it("rejects disabled submission policy and oversize payload", async () => {
    const root = mkdtempSync(join(tmpdir(), "submission-guards-"));
    writeFileSync(join(root, "index.html"), "<html></html>");
    const dbPath = join(root, "admin.sqlite");
    const {handle: h, db} = await bootSubmissionHost(root, dbPath);
    const fixture = await seedSubmissionFixture(h, db);

    db.sqlite
      .prepare(`UPDATE classroom_policies SET submission_enabled = 0 WHERE policy_id = ?`)
      .run(fixture.policyId);

    const disabled = buildMultipartBody({
      projectTitle: "Work",
      idempotencyKey: "key-disabled",
      sb3: Buffer.from("X"),
    });
    const disabledRes = await fetch(new URL(STUDENT_SUBMISSIONS_PATH, h.url), {
      method: "POST",
      headers: {
        cookie: `${fixture.grantCookie}; ${fixture.identityCookie}`,
        "content-type": disabled.contentType,
      },
      body: new Uint8Array(disabled.body),
    });
    expect(disabledRes.status).toBe(403);

    db.sqlite
      .prepare(`UPDATE classroom_policies SET submission_enabled = 1 WHERE policy_id = ?`)
      .run(fixture.policyId);

    const huge = Buffer.alloc(5 * 1024 * 1024 + 1, 1);
    const oversize = buildMultipartBody({
      projectTitle: "Huge",
      idempotencyKey: "key-huge",
      sb3: huge,
    });
    const oversizeRes = await fetch(new URL(STUDENT_SUBMISSIONS_PATH, h.url), {
      method: "POST",
      headers: {
        cookie: `${fixture.grantCookie}; ${fixture.identityCookie}`,
        "content-type": oversize.contentType,
      },
      body: new Uint8Array(oversize.body),
    });
    expect(oversizeRes.status).toBe(413);
  });

  it("exposes admin list/detail/content routes", async () => {
    const root = mkdtempSync(join(tmpdir(), "submission-admin-"));
    writeFileSync(join(root, "index.html"), "<html></html>");
    const dbPath = join(root, "admin.sqlite");
    const {handle: h, db} = await bootSubmissionHost(root, dbPath);
    const fixture = await seedSubmissionFixture(h, db);

    const multipart = buildMultipartBody({
      projectTitle: "Work",
      idempotencyKey: "admin-key",
      sb3: Buffer.from("ADMIN-SB3"),
    });
    const submit = await fetch(new URL(STUDENT_SUBMISSIONS_PATH, h.url), {
      method: "POST",
      headers: {
        cookie: `${fixture.grantCookie}; ${fixture.identityCookie}`,
        "content-type": multipart.contentType,
      },
      body: new Uint8Array(multipart.body),
    });
    expect(submit.status).toBe(201);
    const submitBody = (await submit.json()) as {
      submission: {submissionId: string};
    };

    const list = await fetch(
      new URL(adminPolicySubmissionsPath(fixture.policyId), h.url),
      {headers: {cookie: fixture.cookie}},
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {submissions: Array<{submissionId: string}>};
    expect(listBody.submissions[0]?.submissionId).toBe(
      submitBody.submission.submissionId,
    );

    const detail = await fetch(
      new URL(adminSubmissionPath(submitBody.submission.submissionId), h.url),
      {headers: {cookie: fixture.cookie}},
    );
    expect(detail.status).toBe(200);

    const content = await fetch(
      new URL(adminSubmissionContentPath(submitBody.submission.submissionId), h.url),
      {headers: {cookie: fixture.cookie}},
    );
    expect(content.status).toBe(200);
    expect(content.headers.get("content-type")).toContain("sb3");
    const disposition = content.headers.get("content-disposition") ?? "";
    expect(decodeURIComponent(disposition)).toMatch(
      /filename="261101_Student One_Work_\d{8}-\d{6}\.sb3"/,
    );
  });

  it("sorts admin list by student_code ascending then submitted_at descending", async () => {
    const root = mkdtempSync(join(tmpdir(), "submission-sort-"));
    writeFileSync(join(root, "index.html"), "<html></html>");
    const dbPath = join(root, "admin.sqlite");
    const {handle: h, db} = await bootSubmissionHost(root, dbPath);
    const fixture = await seedSubmissionFixture(h, db);

    const multipart = buildMultipartBody({
      projectTitle: "Latest",
      idempotencyKey: "sort-key-latest",
      sb3: Buffer.from("SORT-SB3"),
    });
    const submit = await fetch(new URL(STUDENT_SUBMISSIONS_PATH, h.url), {
      method: "POST",
      headers: {
        cookie: `${fixture.grantCookie}; ${fixture.identityCookie}`,
        "content-type": multipart.contentType,
      },
      body: new Uint8Array(multipart.body),
    });
    expect(submit.status).toBe(201);
    const submitBody = (await submit.json()) as {
      submission: {submissionId: string};
    };
    const accountRow = db.sqlite
      .prepare(`SELECT student_account_id FROM classroom_submissions WHERE submission_id = ?`)
      .get(submitBody.submission.submissionId) as {student_account_id: string};

    const studentTwoId = "student-submit-2";
    const ts = new Date().toISOString();
    db.sqlite
      .prepare(
        `INSERT INTO classroom_students (
          student_id, owner_admin_id, student_code, display_name,
          attendance_number, login_name, group_label, active,
          archived_at, created_at, updated_at
        ) VALUES (?, (SELECT owner_admin_id FROM classroom_students WHERE student_id = ?), ?, ?, ?, ?, ?, 1, NULL, ?, ?)`,
      )
      .run(
        studentTwoId,
        fixture.studentId,
        "261102",
        "Student Two",
        "02",
        "student.two",
        null,
        ts,
        ts,
      );
    db.sqlite
      .prepare(
        `INSERT INTO classroom_roster_memberships (
          membership_id, roster_id, student_id, active, created_at, updated_at
        ) VALUES (?, (SELECT roster_id FROM classroom_roster_memberships WHERE student_id = ? LIMIT 1), ?, 1, ?, ?)`,
      )
      .run("membership-submit-2", fixture.studentId, studentTwoId, ts, ts);
    db.sqlite
      .prepare(
        `INSERT INTO student_accounts (
          account_id, student_id, status, password_hash, enrollment_code_hash,
          enrollment_code_expires_at, password_version, created_at, updated_at
        ) VALUES (?, ?, 'active', NULL, NULL, NULL, 1, ?, ?)`,
      )
      .run("account-submit-2", studentTwoId, ts, ts);

    const insertSubmission = db.sqlite.prepare(
      `INSERT INTO classroom_submissions (
        submission_id, policy_id, student_id, student_account_id,
        drive_file_id, content_sha256, size_bytes, project_title,
        status, is_resubmission, idempotency_key,
        submitted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?, ?, ?, ?, ?)`,
    );
    insertSubmission.run(
      "submission-sort-261101-old",
      fixture.policyId,
      fixture.studentId,
      accountRow.student_account_id,
      "drive-old",
      "sha-old",
      10,
      "Older",
      1,
      "sort-key-old",
      "2026-04-15T10:00:00.000Z",
      ts,
      ts,
    );
    insertSubmission.run(
      "submission-sort-261102",
      fixture.policyId,
      studentTwoId,
      "account-submit-2",
      "drive-two",
      "sha-two",
      10,
      "Other student",
      0,
      "sort-key-two",
      "2026-04-15T09:00:00.000Z",
      ts,
      ts,
    );

    const list = await fetch(
      new URL(adminPolicySubmissionsPath(fixture.policyId), h.url),
      {headers: {cookie: fixture.cookie}},
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      submissions: Array<{submissionId: string; studentCode: string}>;
    };
    expect(listBody.submissions.map(item => item.submissionId)).toEqual([
      submitBody.submission.submissionId,
      "submission-sort-261101-old",
      "submission-sort-261102",
    ]);
    expect(listBody.submissions.map(item => item.studentCode)).toEqual([
      "261101",
      "261101",
      "261102",
    ]);
  });
});
