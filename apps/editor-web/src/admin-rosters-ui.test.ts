/** @vitest-environment jsdom */
import {describe, expect, it, vi, beforeEach, afterEach} from "vitest";
import {
  ADMIN_GOOGLE_OAUTH_SESSION_PATH,
  ADMIN_ROSTERS_PATH,
  adminRosterPath,
  adminRosterStudentsPath,
} from "@blocksync/classroom-access";
import {
  fetchAdminRosterList,
  buildSpreadsheetEditUrl,
  mountAdminRostersSection,
  mountPolicyRosterControls,
  renderAccountPane,
  renderRosterPane,
} from "./admin-rosters-ui.js";
import {createAdminSaveFooter} from "./admin-console-shared.js";

const samplePolicy = {
  policyId: "policy-1",
  ownerAdminId: "admin-1",
  title: "Class A",
  status: "active" as const,
  rosterId: null,
  submissionDriveFolderId: null,
  studentAuth: {
    required: false,
    method: "google-or-local",
    allowedEmailDomains: [],
  },
  submission: {enabled: false},
  aiAssist: {enabled: false, level: 0, allowStudentApiKey: false},
  editor: {
    showSettingsPanel: false,
    allowSb3Export: true,
    allowSb3Import: true,
    allowExtensions: false,
  },
  collab: {allow: false},
  drive: {allow: false},
  createdAt: "t0",
  updatedAt: "t1",
};

const disabledFlags = {
  classroomRosterEnabled: false,
  adminGoogleCredentialEnabled: false,
  rosterSheetsEnabled: false,
  studentLocalAuthEnabled: false,
  rosterGoogleStudentAuthEnabled: false,
  teacherDriveSubmissionEnabled: false,
  submissionPreviewEnabled: false,
};

describe("admin rosters ui", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds spreadsheet edit url from id", () => {
    expect(buildSpreadsheetEditUrl("abc123")).toBe(
      "https://docs.google.com/spreadsheets/d/abc123/edit",
    );
    expect(buildSpreadsheetEditUrl("  ")).toBe("");
  });

  it("loads roster list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          rosters: [{rosterId: "r1", title: "3A", studentCount: 2, syncStatus: "active"}],
        }),
      })),
    );

    const rosters = await fetchAdminRosterList();
    expect(rosters).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(ADMIN_ROSTERS_PATH, expect.any(Object));
  });

  it("shows disabled message when roster flag is off", async () => {
    const host = document.createElement("div");
    await mountAdminRostersSection(host, () => "csrf", disabledFlags);

    expect(host.querySelector("[data-testid=admin-rosters-panel]")).toBeTruthy();
    expect(host.textContent).toContain("SYNCRATCH_CLASSROOM_ROSTER_ENABLED");
  });

  it("renders account pane with google credential section", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === ADMIN_GOOGLE_OAUTH_SESSION_PATH) {
          return {
            ok: true,
            json: async () => ({ok: true, connected: false}),
          };
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const pane = renderAccountPane({
      getCsrf: () => "csrf",
      flags: {...disabledFlags, adminGoogleCredentialEnabled: true, classroomRosterEnabled: true},
      saveFooter: createAdminSaveFooter(),
      onRefresh: async () => {},
      rosters: [],
      adminEmail: "t@example.com",
    });

    expect(pane.querySelector("[data-testid=admin-roster-credential]")).toBeTruthy();
    expect(pane.querySelector(".admin2-account-card")).toBeTruthy();
    expect(pane.textContent?.match(/ログアウト/g)?.length ?? 0).toBe(0);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(pane.textContent).toContain("Google と連携");
  });

  it("renders roster pane with student table and hidden open sheet link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === adminRosterPath("r1")) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              roster: {
                rosterId: "r1",
                title: "3A",
                rosterRevision: 1,
                syncStatus: "active",
                sheetSpreadsheetId: null,
                sheetTabName: "Sheet1",
                sheetRange: null,
                createdAt: "t0",
                updatedAt: "t1",
              },
            }),
          };
        }
        if (url === adminRosterStudentsPath("r1")) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              students: [
                {
                  studentId: "s1",
                  studentCode: "001",
                  displayName: "Alice",
                  attendanceNumber: "1",
                  loginName: null,
                  googleEmail: "alice@school.example",
                  googleSubject: null,
                  groupLabel: null,
                  active: true,
                  accountStatus: "active",
                  firstRegisteredAt: "t0",
                  googleIdentityEstablishedAt: null,
                  createdAt: "t0",
                  updatedAt: "t1",
                },
              ],
            }),
          };
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const pane = await renderRosterPane(
      {
        getCsrf: () => "csrf",
        flags: {...disabledFlags, classroomRosterEnabled: true, rosterSheetsEnabled: true},
        saveFooter: createAdminSaveFooter(),
        onRefresh: async () => {},
        rosters: [{rosterId: "r1", title: "3A", studentCount: 1, syncStatus: "active", rosterRevision: 1, createdAt: "t0", updatedAt: "t1"}],
        adminEmail: "t@example.com",
      },
      "r1",
    );

    expect(pane?.querySelector("[data-testid=admin-roster-card]")).toBeTruthy();
    expect(pane?.querySelector(".admin-roster-student-table")).toBeTruthy();
    expect(
      pane?.querySelector<HTMLAnchorElement>("[data-testid=admin-roster-open-sheet]")?.hidden,
    ).toBe(true);
  });

  it("shows open sheet button when spreadsheet id is bound", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === adminRosterPath("r1")) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              roster: {
                rosterId: "r1",
                title: "3A",
                rosterRevision: 1,
                syncStatus: "active",
                sheetSpreadsheetId: "sheet-bound-1",
                sheetTabName: "Sheet1",
                sheetRange: null,
                createdAt: "t0",
                updatedAt: "t1",
              },
            }),
          };
        }
        if (url === adminRosterStudentsPath("r1")) {
          return {
            ok: true,
            json: async () => ({ok: true, students: []}),
          };
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const pane = await renderRosterPane(
      {
        getCsrf: () => "csrf",
        flags: {...disabledFlags, classroomRosterEnabled: true, rosterSheetsEnabled: true},
        saveFooter: createAdminSaveFooter(),
        onRefresh: async () => {},
        rosters: [{rosterId: "r1", title: "3A", studentCount: 0, syncStatus: "active", rosterRevision: 1, createdAt: "t0", updatedAt: "t1"}],
        adminEmail: "t@example.com",
      },
      "r1",
    );

    const openSheet = pane?.querySelector<HTMLAnchorElement>(
      "[data-testid=admin-roster-open-sheet]",
    );
    expect(openSheet).toBeTruthy();
    expect(openSheet?.hidden).toBe(false);
    expect(openSheet?.href).toBe(buildSpreadsheetEditUrl("sheet-bound-1"));
    expect(openSheet?.textContent).toContain("テンプレート Sheet を開く");
  });

  it("add student button shows inline form and posts student", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === adminRosterPath("r1")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            roster: {
              rosterId: "r1",
              title: "3A",
              rosterRevision: 1,
              syncStatus: "active",
              sheetSpreadsheetId: "sheet-bound-1",
              sheetTabName: "Sheet1",
              sheetRange: null,
              createdAt: "t0",
              updatedAt: "t1",
            },
          }),
        };
      }
      if (url === adminRosterStudentsPath("r1") && (!init?.method || init.method === "GET")) {
        return {
          ok: true,
          json: async () => ({ok: true, students: []}),
        };
      }
      if (url === adminRosterStudentsPath("r1") && init?.method === "POST") {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            student: {
              studentId: "s-new",
              studentCode: "S001",
              displayName: "山田太郎",
              attendanceNumber: "01",
              loginName: "S001",
              groupLabel: "A",
              active: true,
              accountStatus: "pending_activation",
              firstRegisteredAt: null,
              createdAt: "t0",
              updatedAt: "t0",
            },
          }),
        };
      }
      throw new Error(`unexpected fetch ${url} ${init?.method ?? "GET"}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const pane = await renderRosterPane(
      {
        getCsrf: () => "csrf",
        flags: {...disabledFlags, classroomRosterEnabled: true, rosterSheetsEnabled: true},
        saveFooter: createAdminSaveFooter(),
        onRefresh: async () => {},
        rosters: [{rosterId: "r1", title: "3A", studentCount: 0, syncStatus: "active", rosterRevision: 1, createdAt: "t0", updatedAt: "t1"}],
        adminEmail: "t@example.com",
      },
      "r1",
    );

    const addBtn = [...pane!.querySelectorAll("button")].find(
      btn => btn.textContent === "＋ 生徒を追加",
    );
    expect(addBtn).toBeTruthy();
    addBtn!.click();
    expect(pane!.querySelector(".admin2-add-student-form")).toBeTruthy();

    const inputs = pane!.querySelectorAll<HTMLInputElement>(".admin2-add-student-form input");
    inputs[0]!.value = "S001";
    inputs[1]!.value = "山田太郎";
    inputs[2]!.value = "01";
    inputs[4]!.value = "taro@school.example";
    inputs[5]!.value = "A";

    const submitBtn = [...pane!.querySelectorAll("button")].find(
      btn => btn.textContent === "追加する",
    );
    submitBtn!.click();
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        adminRosterStudentsPath("r1"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            studentCode: "S001",
            displayName: "山田太郎",
            attendanceNumber: "01",
            loginName: null,
            googleEmail: "taro@school.example",
            groupLabel: "A",
          }),
        }),
      );
    });
  });

  it("shows template create button when spreadsheet is not bound", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === adminRosterPath("r1")) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              roster: {
                rosterId: "r1",
                title: "3A",
                rosterRevision: 1,
                syncStatus: "active",
                sheetSpreadsheetId: null,
                sheetTabName: "Sheet1",
                sheetRange: null,
                createdAt: "t0",
                updatedAt: "t1",
              },
            }),
          };
        }
        if (url === adminRosterStudentsPath("r1")) {
          return {
            ok: true,
            json: async () => ({ok: true, students: []}),
          };
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const pane = await renderRosterPane(
      {
        getCsrf: () => "csrf",
        flags: {...disabledFlags, classroomRosterEnabled: true, rosterSheetsEnabled: true},
        saveFooter: createAdminSaveFooter(),
        onRefresh: async () => {},
        rosters: [{rosterId: "r1", title: "3A", studentCount: 0, syncStatus: "active", rosterRevision: 1, createdAt: "t0", updatedAt: "t1"}],
        adminEmail: "t@example.com",
      },
      "r1",
    );

    expect(
      pane?.querySelector("[data-testid=admin-roster-create-template]"),
    ).toBeTruthy();
    expect(
      pane?.querySelector<HTMLAnchorElement>("[data-testid=admin-roster-open-sheet]")?.hidden,
    ).toBe(true);
  });

  it("mounts policy roster controls with segment and select", () => {
    const saveFooter = createAdminSaveFooter();
    const panel = mountPolicyRosterControls(
      samplePolicy,
      [{rosterId: "r1", title: "3A", studentCount: 0, syncStatus: "active", rosterRevision: 1, createdAt: "t0", updatedAt: "t1"}],
      {...disabledFlags, classroomRosterEnabled: true},
      () => "csrf",
      saveFooter,
      async () => {},
    );

    expect(panel.getAttribute("data-testid")).toBe("admin-policy-roster");
    expect(panel.querySelector(".admin-roster-select")).toBeTruthy();
    expect(panel.querySelector(".admin2-segment")).toBeTruthy();
  });

  it("shows google auth method controls when rosterGoogleStudentAuthEnabled", () => {
    const panel = mountPolicyRosterControls(
      samplePolicy,
      [{rosterId: "r1", title: "3A", studentCount: 0, syncStatus: "active", rosterRevision: 1, createdAt: "t0", updatedAt: "t1"}],
      {
        ...disabledFlags,
        classroomRosterEnabled: true,
        studentLocalAuthEnabled: true,
        rosterGoogleStudentAuthEnabled: true,
      },
      () => "csrf",
      createAdminSaveFooter(),
      async () => {},
    );

    expect(panel.textContent).toContain("認証方式");
    expect(panel.textContent).toContain("許可ドメイン");
    expect(panel.querySelectorAll(".admin2-segment").length).toBeGreaterThan(1);
  });

  it("shows google roster status badge when google auth flag is on", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === adminRosterPath("r1")) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              roster: {
                rosterId: "r1",
                title: "3A",
                rosterRevision: 1,
                syncStatus: "active",
                sheetSpreadsheetId: null,
                sheetTabName: "Sheet1",
                sheetRange: null,
                createdAt: "t0",
                updatedAt: "t1",
              },
            }),
          };
        }
        if (url === adminRosterStudentsPath("r1")) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              students: [
                {
                  studentId: "s1",
                  studentCode: "001",
                  displayName: "Alice",
                  attendanceNumber: "1",
                  loginName: null,
                  googleEmail: "alice@school.example",
                  googleSubject: null,
                  groupLabel: null,
                  active: true,
                  accountStatus: null,
                  firstRegisteredAt: null,
                  googleIdentityEstablishedAt: null,
                  createdAt: "t0",
                  updatedAt: "t1",
                },
              ],
            }),
          };
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const pane = await renderRosterPane(
      {
        getCsrf: () => "csrf",
        flags: {
          ...disabledFlags,
          classroomRosterEnabled: true,
          rosterGoogleStudentAuthEnabled: true,
        },
        saveFooter: createAdminSaveFooter(),
        onRefresh: async () => {},
        rosters: [{rosterId: "r1", title: "3A", studentCount: 1, syncStatus: "active", rosterRevision: 1, createdAt: "t0", updatedAt: "t1"}],
        adminEmail: "t@example.com",
      },
      "r1",
    );

    expect(pane?.textContent).toContain("名簿一致");
    expect(pane?.textContent).toContain("Google メール");
  });
});
