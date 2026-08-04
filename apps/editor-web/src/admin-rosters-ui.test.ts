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
} from "./admin-rosters-ui.js";

const samplePolicy = {
  policyId: "policy-1",
  ownerAdminId: "admin-1",
  title: "Class A",
  status: "active" as const,
  rosterId: null,
  submissionDriveFolderId: null,
  studentAuth: {required: false},
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
          rosters: [{rosterId: "r1", title: "3A", studentCount: 2, syncStatus: "idle"}],
        }),
      })),
    );

    const rosters = await fetchAdminRosterList();
    expect(rosters).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(ADMIN_ROSTERS_PATH, expect.any(Object));
  });

  it("shows disabled message when roster flag is off", async () => {
    const host = document.createElement("div");
    await mountAdminRostersSection(host, () => "csrf", {
      classroomRosterEnabled: false,
      adminGoogleCredentialEnabled: false,
      rosterSheetsEnabled: false,
      teacherDriveSubmissionEnabled: false,
      submissionPreviewEnabled: false,
    });

    expect(host.querySelector("[data-testid=admin-rosters-panel]")).toBeTruthy();
    expect(host.textContent).toContain("SYNCRATCH_CLASSROOM_ROSTER_ENABLED");
  });

  it("renders roster cards with google credential panel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === ADMIN_ROSTERS_PATH) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              rosters: [{rosterId: "r1", title: "3A", studentCount: 1, syncStatus: "idle"}],
            }),
          };
        }
        if (url === adminRosterPath("r1")) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              roster: {
                rosterId: "r1",
                title: "3A",
                rosterRevision: 1,
                syncStatus: "idle",
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
                  groupLabel: null,
                  active: true,
                },
              ],
            }),
          };
        }
        if (url === ADMIN_GOOGLE_OAUTH_SESSION_PATH) {
          return {
            ok: true,
            json: async () => ({ok: true, connected: false}),
          };
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const host = document.createElement("div");
    await mountAdminRostersSection(host, () => "csrf", {
      classroomRosterEnabled: true,
      adminGoogleCredentialEnabled: true,
      rosterSheetsEnabled: true,
      teacherDriveSubmissionEnabled: false,
      submissionPreviewEnabled: false,
    });

    expect(host.querySelector("[data-testid=admin-roster-credential]")).toBeTruthy();
    expect(host.querySelector("[data-testid=admin-roster-card]")).toBeTruthy();
    expect(host.querySelector(".admin-roster-student-table")).toBeTruthy();
    expect(
      host.querySelector<HTMLAnchorElement>("[data-testid=admin-roster-open-sheet]")?.hidden,
    ).toBe(true);
  });

  it("shows open sheet button when spreadsheet id is bound", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === ADMIN_ROSTERS_PATH) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              rosters: [{rosterId: "r1", title: "3A", studentCount: 0, syncStatus: "idle"}],
            }),
          };
        }
        if (url === adminRosterPath("r1")) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              roster: {
                rosterId: "r1",
                title: "3A",
                rosterRevision: 1,
                syncStatus: "idle",
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
        if (url === ADMIN_GOOGLE_OAUTH_SESSION_PATH) {
          return {
            ok: true,
            json: async () => ({ok: true, connected: true, googleEmail: "t@example.com"}),
          };
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const host = document.createElement("div");
    await mountAdminRostersSection(host, () => "csrf", {
      classroomRosterEnabled: true,
      adminGoogleCredentialEnabled: true,
      rosterSheetsEnabled: true,
      teacherDriveSubmissionEnabled: false,
      submissionPreviewEnabled: false,
    });

    const openSheet = host.querySelector<HTMLAnchorElement>(
      "[data-testid=admin-roster-open-sheet]",
    );
    expect(openSheet).toBeTruthy();
    expect(openSheet?.hidden).toBe(false);
    expect(openSheet?.href).toBe(buildSpreadsheetEditUrl("sheet-bound-1"));
    expect(openSheet?.textContent).toContain("スプレッドシートを開く");
  });

  it("mounts policy roster controls", () => {
    const card = document.createElement("div");
    mountPolicyRosterControls(
      card,
      samplePolicy,
      [{rosterId: "r1", title: "3A", studentCount: 0, syncStatus: "idle"}],
      {
        classroomRosterEnabled: true,
        adminGoogleCredentialEnabled: false,
        rosterSheetsEnabled: false,
        teacherDriveSubmissionEnabled: false,
        submissionPreviewEnabled: false,
      },
      () => "csrf",
      async () => {},
    );

    expect(card.querySelector("[data-testid=admin-policy-roster]")).toBeTruthy();
    expect(card.querySelector(".admin-roster-select")).toBeTruthy();
  });
});
