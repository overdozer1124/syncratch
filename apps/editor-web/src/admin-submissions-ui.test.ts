/** @vitest-environment jsdom */
import {describe, expect, it, vi, beforeEach, afterEach} from "vitest";
import {
  ADMIN_CLASSROOM_FLAGS_PATH,
  adminPolicySubmissionsPath,
  adminSubmissionPreviewSurfacePath,
} from "@blocksync/classroom-access";
import {
  fetchAdminClassroomFlags,
  mountPolicySubmissionsPanel,
} from "./admin-submissions-ui.js";

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
    const detailButton = card.querySelector("button");
    detailButton?.dispatchEvent(new MouseEvent("click", {bubbles: true}));
    await new Promise(resolve => setTimeout(resolve, 0));
    const previewLink = card.querySelector<HTMLAnchorElement>("a.admin-button.primary");
    expect(previewLink?.href).toContain(
      adminSubmissionPreviewSurfacePath("sub-1"),
    );
  });
});
