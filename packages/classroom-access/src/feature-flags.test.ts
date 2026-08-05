import {describe, expect, it} from "vitest";
import {
  CLASSROOM_FEATURE_FLAG_ENV,
  parseClassroomFeatureFlags,
  validateClassroomFeatureFlagDependencies,
} from "./feature-flags.js";

describe("parseClassroomFeatureFlags", () => {
  it("defaults all flags to false", () => {
    expect(parseClassroomFeatureFlags({})).toEqual({
      classroomRosterEnabled: false,
      adminGoogleCredentialEnabled: false,
      rosterSheetsEnabled: false,
      studentLocalAuthEnabled: false,
      rosterGoogleStudentAuthEnabled: false,
      teacherDriveSubmissionEnabled: false,
      submissionPreviewEnabled: false,
    });
  });

  it("parses truthy env values", () => {
    expect(
      parseClassroomFeatureFlags({
        [CLASSROOM_FEATURE_FLAG_ENV.classroomRosterEnabled]: "true",
        [CLASSROOM_FEATURE_FLAG_ENV.studentLocalAuthEnabled]: "1",
      }).classroomRosterEnabled,
    ).toBe(true);
  });
});

describe("validateClassroomFeatureFlagDependencies", () => {
  it("reports missing dependency chain", () => {
    const issues = validateClassroomFeatureFlagDependencies({
      classroomRosterEnabled: false,
      adminGoogleCredentialEnabled: true,
      rosterSheetsEnabled: true,
      studentLocalAuthEnabled: true,
      rosterGoogleStudentAuthEnabled: true,
      teacherDriveSubmissionEnabled: true,
      submissionPreviewEnabled: true,
    });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some(item => item.includes("CLASSROOM_ROSTER_ENABLED"))).toBe(
      true,
    );
  });

  it("accepts a valid chain", () => {
    expect(
      validateClassroomFeatureFlagDependencies({
        classroomRosterEnabled: true,
        adminGoogleCredentialEnabled: true,
        rosterSheetsEnabled: true,
        studentLocalAuthEnabled: true,
        rosterGoogleStudentAuthEnabled: true,
        teacherDriveSubmissionEnabled: true,
        submissionPreviewEnabled: true,
      }),
    ).toEqual([]);
  });

  it("requires studentLocalAuth for rosterGoogleStudentAuth", () => {
    const issues = validateClassroomFeatureFlagDependencies({
      classroomRosterEnabled: true,
      adminGoogleCredentialEnabled: false,
      rosterSheetsEnabled: false,
      studentLocalAuthEnabled: false,
      rosterGoogleStudentAuthEnabled: true,
      teacherDriveSubmissionEnabled: false,
      submissionPreviewEnabled: false,
    });
    expect(
      issues.some(item => item.includes("ROSTER_GOOGLE_STUDENT_AUTH_ENABLED")),
    ).toBe(true);
  });
});
