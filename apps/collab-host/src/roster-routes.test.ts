import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach, beforeEach, describe, expect, it} from "vitest";
import {
  ADMIN_AUTH_GOOGLE_PATH,
  ADMIN_POLICIES_PATH,
  ADMIN_ROSTERS_PATH,
  ROSTER_SHEET_COLUMNS,
  adminRosterImportApplyPath,
  adminRosterImportPreviewPath,
  adminRosterImportsPath,
  adminRosterPath,
  adminRosterSheetTemplatePath,
  adminRosterStudentsPath,
  adminRosterSyncPath,
} from "@blocksync/classroom-access";
import {
  parseRosterAdminPath,
} from "./roster-routes.js";
import {
  ADMIN_SESSION_COOKIE,
  createMemoryAdminSessionStore,
  type AdminAuthConfig,
} from "./admin-auth.js";
import {openAdminDb} from "./admin-db.js";
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

async function boot(
  config: AdminAuthConfig,
  dbPath: string,
  root: string,
  classroomRosterEnabled: boolean,
  rosterSheetsEnabled = false,
) {
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
      classroomRosterEnabled,
      rosterSheetsEnabled,
      classroomFlags: rosterSheetsEnabled
        ? {
            classroomRosterEnabled: true,
            adminGoogleCredentialEnabled: true,
            rosterSheetsEnabled: true,
          }
        : undefined,
      adminGoogleOAuthEnabled: rosterSheetsEnabled,
    },
  });
  return {handle: handle!, db, sessions};
}

async function loginAdmin(baseUrl: string, config: AdminAuthConfig) {
  const response = await fetch(new URL(ADMIN_AUTH_GOOGLE_PATH, baseUrl), {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({idToken: "tok"}),
  });
  expect(response.status).toBe(200);
  return cookieJar(response);
}

describe("parseRosterAdminPath", () => {
  it("parses sheet-template route", () => {
    expect(parseRosterAdminPath(adminRosterSheetTemplatePath("r1"))).toEqual({
      rosterId: "r1",
      action: "sheet_template",
    });
  });
});

describe("roster admin routes", () => {
  it("returns 404 when classroom roster flag is OFF", async () => {
    const root = mkdtempSync(join(tmpdir(), "collab-host-roster-off-"));
    writeFileSync(join(root, "index.html"), "<html>host</html>");
    const dbPath = join(root, "admin.sqlite");
    const config: AdminAuthConfig = {
      clientId: "test-client.apps.googleusercontent.com",
      allowlist: new Set(["teacher@school.example"]),
      cookieSecure: false,
      verifyGoogleIdToken: async () =>
        claims("teacher@school.example", "google-sub-roster-off"),
    };
    const {handle: h} = await boot(config, dbPath, root, false);
    const {cookie} = await loginAdmin(h.url, config);
    const response = await fetch(new URL(ADMIN_ROSTERS_PATH, h.url), {
      headers: {cookie},
    });
    expect(response.status).toBe(404);
  });

  it("imports CSV preview and applies with leading-zero attendance", async () => {
    const root = mkdtempSync(join(tmpdir(), "collab-host-roster-on-"));
    writeFileSync(join(root, "index.html"), "<html>host</html>");
    const dbPath = join(root, "admin.sqlite");
    const config: AdminAuthConfig = {
      clientId: "test-client.apps.googleusercontent.com",
      allowlist: new Set(["teacher@school.example"]),
      cookieSecure: false,
      verifyGoogleIdToken: async () =>
        claims("teacher@school.example", "google-sub-roster-on"),
    };
    const {handle: h, db} = await boot(config, dbPath, root, true);
    const {cookie, csrfToken} = await loginAdmin(h.url, config);

    const policyOk = await fetch(new URL(ADMIN_POLICIES_PATH, h.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({title: "回帰確認"}),
    });
    expect(policyOk.status).toBe(201);

    const created = await fetch(new URL(ADMIN_ROSTERS_PATH, h.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({title: "3年A組"}),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as {roster: {rosterId: string}};
    const rosterId = createdBody.roster.rosterId;

    const csv = [
      ROSTER_SHEET_COLUMNS.join(","),
      "S001,山田太郎,007,yamada01,A,true",
    ].join("\n");
    const imported = await fetch(
      new URL(adminRosterImportsPath(rosterId), h.url),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({csv}),
      },
    );
    expect(imported.status).toBe(201);
    const importBody = (await imported.json()) as {
      import: {importId: string};
      previewHash: string;
      baseRosterRevision: number;
      deactivateMissing: boolean;
    };

    const preview = await fetch(
      new URL(
        adminRosterImportPreviewPath(rosterId, importBody.import.importId),
        h.url,
      ),
      {headers: {cookie}},
    );
    expect(preview.status).toBe(200);

    const applied = await fetch(
      new URL(
        adminRosterImportApplyPath(rosterId, importBody.import.importId),
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
          previewHash: importBody.previewHash,
          baseRosterRevision: importBody.baseRosterRevision,
          deactivateMissing: importBody.deactivateMissing,
        }),
      },
    );
    expect(applied.status).toBe(200);

    const students = await fetch(
      new URL(adminRosterStudentsPath(rosterId), h.url),
      {headers: {cookie}},
    );
    expect(students.status).toBe(200);
    const studentBody = (await students.json()) as {
      students: Array<{attendanceNumber: string | null}>;
    };
    expect(studentBody.students[0]?.attendanceNumber).toBe("007");

    const auditCount = db.sqlite
      .prepare(`SELECT COUNT(*) AS c FROM classroom_audit_events WHERE roster_id = ?`)
      .get(rosterId) as {c: number};
    expect(auditCount.c).toBeGreaterThan(0);
  });

  it("returns 409 for stale preview on apply", async () => {
    const root = mkdtempSync(join(tmpdir(), "collab-host-roster-stale-"));
    writeFileSync(join(root, "index.html"), "<html>host</html>");
    const dbPath = join(root, "admin.sqlite");
    const config: AdminAuthConfig = {
      clientId: "test-client.apps.googleusercontent.com",
      allowlist: new Set(["teacher@school.example"]),
      cookieSecure: false,
      verifyGoogleIdToken: async () =>
        claims("teacher@school.example", "google-sub-roster-stale"),
    };
    const {handle: h} = await boot(config, dbPath, root, true);
    const {cookie, csrfToken} = await loginAdmin(h.url, config);

    const created = await fetch(new URL(ADMIN_ROSTERS_PATH, h.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({title: "名簿"}),
    });
    const {roster} = (await created.json()) as {roster: {rosterId: string}};
    const csv = [
      ROSTER_SHEET_COLUMNS.join(","),
      "S001,山田,01,y,A,true",
    ].join("\n");
    const imported = await fetch(
      new URL(adminRosterImportsPath(roster.rosterId), h.url),
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie,
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify({csv}),
      },
    );
    const importBody = (await imported.json()) as {import: {importId: string}};

    const stale = await fetch(
      new URL(
        adminRosterImportApplyPath(roster.rosterId, importBody.import.importId),
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
          previewHash: "0".repeat(64),
          baseRosterRevision: 0,
          deactivateMissing: false,
        }),
      },
    );
    expect(stale.status).toBe(409);
  });

  it("does not expose DELETE /api/admin/rosters/:id", async () => {
    const root = mkdtempSync(join(tmpdir(), "collab-host-roster-no-delete-"));
    writeFileSync(join(root, "index.html"), "<html>host</html>");
    const dbPath = join(root, "admin.sqlite");
    const config: AdminAuthConfig = {
      clientId: "test-client.apps.googleusercontent.com",
      allowlist: new Set(["teacher@school.example"]),
      cookieSecure: false,
      verifyGoogleIdToken: async () =>
        claims("teacher@school.example", "google-sub-no-delete"),
    };
    const {handle: h} = await boot(config, dbPath, root, true);
    const {cookie, csrfToken} = await loginAdmin(h.url, config);
    const created = await fetch(new URL(ADMIN_ROSTERS_PATH, h.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({title: "名簿"}),
    });
    const {roster} = (await created.json()) as {roster: {rosterId: string}};
    const deleted = await fetch(new URL(adminRosterPath(roster.rosterId), h.url), {
      method: "DELETE",
      headers: {cookie, "x-csrf-token": csrfToken},
    });
    expect(deleted.status).toBe(405);
  });

  it("returns 404 for sync when rosterSheets flag is OFF", async () => {
    const root = mkdtempSync(join(tmpdir(), "collab-host-roster-sync-off-"));
    writeFileSync(join(root, "index.html"), "<html>host</html>");
    const dbPath = join(root, "admin.sqlite");
    const config: AdminAuthConfig = {
      clientId: "test-client.apps.googleusercontent.com",
      allowlist: new Set(["teacher@school.example"]),
      cookieSecure: false,
      verifyGoogleIdToken: async () =>
        claims("teacher@school.example", "google-sub-sync-off"),
    };
    const {handle: h} = await boot(config, dbPath, root, true, false);
    const {cookie, csrfToken} = await loginAdmin(h.url, config);
    const created = await fetch(new URL(ADMIN_ROSTERS_PATH, h.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({title: "名簿"}),
    });
    const {roster} = (await created.json()) as {roster: {rosterId: string}};
    const sync = await fetch(new URL(adminRosterSyncPath(roster.rosterId), h.url), {
      method: "POST",
      headers: {cookie, "x-csrf-token": csrfToken},
    });
    expect(sync.status).toBe(404);
  });

  it("returns 409 for sync when teacher credential is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "collab-host-roster-sync-no-cred-"));
    writeFileSync(join(root, "index.html"), "<html>host</html>");
    const dbPath = join(root, "admin.sqlite");
    const config: AdminAuthConfig = {
      clientId: "test-client.apps.googleusercontent.com",
      allowlist: new Set(["teacher@school.example"]),
      cookieSecure: false,
      verifyGoogleIdToken: async () =>
        claims("teacher@school.example", "google-sub-sync-no-cred"),
    };
    process.env.SYNCRATCH_ADMIN_GOOGLE_ACTIVE_KEY_ID = "test-key";
    process.env.SYNCRATCH_ADMIN_GOOGLE_KEYS_JSON = JSON.stringify({
      "test-key": Buffer.alloc(32, 7).toString("base64"),
    });
    process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    const {handle: h} = await boot(config, dbPath, root, true, true);
    const {cookie, csrfToken} = await loginAdmin(h.url, config);
    const created = await fetch(new URL(ADMIN_ROSTERS_PATH, h.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({title: "名簿"}),
    });
    const {roster} = (await created.json()) as {roster: {rosterId: string}};
    await fetch(new URL(adminRosterPath(roster.rosterId), h.url), {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({
        sheetSpreadsheetId: "sheet-123",
        sheetTabName: "Roster",
      }),
    });
    const sync = await fetch(new URL(adminRosterSyncPath(roster.rosterId), h.url), {
      method: "POST",
      headers: {cookie, "x-csrf-token": csrfToken},
    });
    expect(sync.status).toBe(409);
    delete process.env.SYNCRATCH_ADMIN_GOOGLE_ACTIVE_KEY_ID;
    delete process.env.SYNCRATCH_ADMIN_GOOGLE_KEYS_JSON;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it("returns 404 for sheet template when rosterSheets flag is OFF", async () => {
    const root = mkdtempSync(join(tmpdir(), "collab-host-roster-template-off-"));
    writeFileSync(join(root, "index.html"), "<html>host</html>");
    const dbPath = join(root, "admin.sqlite");
    const config: AdminAuthConfig = {
      clientId: "test-client.apps.googleusercontent.com",
      allowlist: new Set(["teacher@school.example"]),
      cookieSecure: false,
      verifyGoogleIdToken: async () =>
        claims("teacher@school.example", "google-sub-template-off"),
    };
    const {handle: h} = await boot(config, dbPath, root, true, false);
    const {cookie, csrfToken} = await loginAdmin(h.url, config);
    const created = await fetch(new URL(ADMIN_ROSTERS_PATH, h.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({title: "名簿"}),
    });
    const {roster} = (await created.json()) as {roster: {rosterId: string}};
    const template = await fetch(
      new URL(adminRosterSheetTemplatePath(roster.rosterId), h.url),
      {
        method: "POST",
        headers: {cookie, "x-csrf-token": csrfToken},
      },
    );
    expect(template.status).toBe(404);
  });

  it("returns 409 for sheet template when teacher credential is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "collab-host-roster-template-no-cred-"));
    writeFileSync(join(root, "index.html"), "<html>host</html>");
    const dbPath = join(root, "admin.sqlite");
    const config: AdminAuthConfig = {
      clientId: "test-client.apps.googleusercontent.com",
      allowlist: new Set(["teacher@school.example"]),
      cookieSecure: false,
      verifyGoogleIdToken: async () =>
        claims("teacher@school.example", "google-sub-template-no-cred"),
    };
    process.env.SYNCRATCH_ADMIN_GOOGLE_ACTIVE_KEY_ID = "test-key";
    process.env.SYNCRATCH_ADMIN_GOOGLE_KEYS_JSON = JSON.stringify({
      "test-key": Buffer.alloc(32, 7).toString("base64"),
    });
    process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "secret";
    const {handle: h} = await boot(config, dbPath, root, true, true);
    const {cookie, csrfToken} = await loginAdmin(h.url, config);
    const created = await fetch(new URL(ADMIN_ROSTERS_PATH, h.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie,
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({title: "名簿"}),
    });
    const {roster} = (await created.json()) as {roster: {rosterId: string}};
    const template = await fetch(
      new URL(adminRosterSheetTemplatePath(roster.rosterId), h.url),
      {
        method: "POST",
        headers: {cookie, "x-csrf-token": csrfToken},
      },
    );
    expect(template.status).toBe(409);
    delete process.env.SYNCRATCH_ADMIN_GOOGLE_ACTIVE_KEY_ID;
    delete process.env.SYNCRATCH_ADMIN_GOOGLE_KEYS_JSON;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });
});
