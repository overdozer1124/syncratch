/** @vitest-environment jsdom */
import {describe, expect, it, vi, beforeEach, afterEach} from "vitest";
import {
  ADMIN_CLASSROOM_FLAGS_PATH,
  ADMIN_GOOGLE_OAUTH_PICKER_TOKEN_PATH,
  ADMIN_GOOGLE_OAUTH_SESSION_PATH,
  ADMIN_POLICIES_PATH,
  adminPolicySubmissionsPath,
  adminSubmissionPreviewSurfacePath,
  type ClassroomPolicy,
} from "@blocksync/classroom-access";
import {
  fetchAdminClassroomFlags,
  mountPolicySubmissionSettings,
  mountPolicySubmissionsPanel,
} from "./admin-submissions-ui.js";
import {createAdminSaveFooter} from "./admin-console-shared.js";

function samplePolicy(overrides: Partial<ClassroomPolicy> = {}): ClassroomPolicy {
  return {
    policyId: "policy-1",
    ownerAdminId: "admin-1",
    title: "Class A",
    status: "active",
    rosterId: null,
    submissionDriveFolderId: null,
    studentAuth: {required: true, method: "local", allowedEmailDomains: []},
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
    ...overrides,
  };
}

describe("admin submissions ui", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads classroom flags", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          flags: {
            classroomRosterEnabled: true,
            adminGoogleCredentialEnabled: true,
            rosterSheetsEnabled: true,
            teacherDriveSubmissionEnabled: true,
            submissionPreviewEnabled: true,
          },
        }),
      })),
    );

    const flags = await fetchAdminClassroomFlags();
    expect(flags?.submissionPreviewEnabled).toBe(true);
    expect(fetch).toHaveBeenCalledWith(ADMIN_CLASSROOM_FLAGS_PATH, expect.any(Object));
  });

  it("renders submission rows and preview link when enabled", async () => {
    const policyId = "policy-1";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === adminPolicySubmissionsPath(policyId)) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              submissions: [
                {
                  submissionId: "sub-1",
                  policyId,
                  studentId: "stu-1",
                  studentCode: "S001",
                  displayName: "Student One",
                  attendanceNumber: "01",
                  projectTitle: "My Work",
                  submittedAt: "2026-08-04T00:00:00.000Z",
                  isResubmission: false,
                  sizeBytes: 128,
                  status: "submitted",
                },
              ],
            }),
          };
        }
        if (url.endsWith("/sub-1")) {
          return {
            ok: true,
            json: async () => ({
              ok: true,
              submission: {
                submissionId: "sub-1",
                policyId,
                studentId: "stu-1",
                studentCode: "S001",
                displayName: "Student One",
                attendanceNumber: "01",
                projectTitle: "My Work",
                submittedAt: "2026-08-04T00:00:00.000Z",
                isResubmission: false,
                sizeBytes: 128,
                status: "submitted",
                contentSha256: "abc",
                driveFileId: "drive-1",
              },
            }),
          };
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const card = document.createElement("div");
    await mountPolicySubmissionsPanel(
      card,
      {
        policyId,
        ownerAdminId: "admin-1",
        title: "Class A",
        status: "active",
        rosterId: null,
        submissionDriveFolderId: "folder-1",
        studentAuth: {required: true},
        submission: {enabled: true},
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
      },
      {
        classroomRosterEnabled: true,
        adminGoogleCredentialEnabled: false,
        rosterSheetsEnabled: false,
        teacherDriveSubmissionEnabled: true,
        submissionPreviewEnabled: true,
      },
    );

    expect(card.querySelector(".admin-submission-table")).toBeTruthy();
    const detailRow = card.querySelector("tr.is-clickable");
    detailRow?.dispatchEvent(new MouseEvent("click", {bubbles: true}));
    await new Promise(resolve => setTimeout(resolve, 0));
    const previewLink = card.querySelector<HTMLAnchorElement>("a.admin2-btn-primary");
    expect(previewLink?.href).toContain(
      adminSubmissionPreviewSurfacePath("sub-1"),
    );
  });

  it("renders submission settings and saves folder + enabled state", async () => {
    const policy = samplePolicy();
    const saveFooter = createAdminSaveFooter();
    const patchCalls: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === ADMIN_GOOGLE_OAUTH_SESSION_PATH) {
          return {
            ok: true,
            json: async () => ({ok: true, connected: true, googleEmail: "t@school.jp"}),
          };
        }
        if (url === ADMIN_GOOGLE_OAUTH_PICKER_TOKEN_PATH) {
          return {
            ok: true,
            json: async () => ({ok: true, accessToken: "picker-token"}),
          };
        }
        if (url === `${ADMIN_POLICIES_PATH}/policy-1` && init?.method === "PATCH") {
          patchCalls.push(JSON.parse(String(init.body)));
          return {ok: true, json: async () => ({ok: true})};
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    const host = document.createElement("div");
    const panel = mountPolicySubmissionSettings(
      policy,
      {
        classroomRosterEnabled: true,
        adminGoogleCredentialEnabled: true,
        rosterSheetsEnabled: false,
        teacherDriveSubmissionEnabled: true,
        submissionPreviewEnabled: false,
      },
      () => "csrf",
      saveFooter,
      async () => {},
      async () => "folder-abc123",
    );
    host.append(panel);

    const pickBtn = [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      btn => btn.textContent === "Drive フォルダを選ぶ",
    );
    pickBtn?.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(patchCalls).toEqual([
      {
        submission: {enabled: false},
        submissionDriveFolderId: "folder-abc123",
      },
    ]);
    expect(policy.submissionDriveFolderId).toBe("folder-abc123");
  });

  it("blocks enabling submission without a folder", async () => {
    const policy = samplePolicy();
    const saveFooter = createAdminSaveFooter();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ok: true}),
      })),
    );

    const host = document.createElement("div");
    host.append(
      mountPolicySubmissionSettings(
        policy,
        {
          classroomRosterEnabled: true,
          adminGoogleCredentialEnabled: true,
          rosterSheetsEnabled: false,
          teacherDriveSubmissionEnabled: true,
          submissionPreviewEnabled: false,
        },
        () => "csrf",
        saveFooter,
        async () => {},
      ),
    );

    const onBtn = [...host.querySelectorAll<HTMLButtonElement>(".admin2-segment-btn")].find(
      btn => btn.textContent === "ON",
    );
    onBtn?.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(policy.submission.enabled).toBe(false);
    expect(host.querySelector(".admin-submission-settings-feedback")?.textContent).toContain(
      "Drive フォルダ",
    );
  });
});
