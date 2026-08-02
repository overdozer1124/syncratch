import {beforeEach, describe, expect, it, vi} from "vitest";
import {CLASSROOM_FEATURE_FLAG_ENV} from "@blocksync/classroom-access";
import {
  ClassroomFeatureFlagsNotInitializedError,
  getClassroomFeatureFlagsForRuntime,
  resetClassroomFeatureFlagsCacheForTests,
  resolveClassroomFeatureFlagsForStartup,
} from "./classroom-feature-flags-runtime.js";

describe("resolveClassroomFeatureFlagsForStartup", () => {
  beforeEach(() => {
    resetClassroomFeatureFlagsCacheForTests();
  });

  it("returns parsed flags when dependency chain is valid", () => {
    const result = resolveClassroomFeatureFlagsForStartup({
      [CLASSROOM_FEATURE_FLAG_ENV.classroomRosterEnabled]: "true",
      [CLASSROOM_FEATURE_FLAG_ENV.adminGoogleCredentialEnabled]: "true",
      [CLASSROOM_FEATURE_FLAG_ENV.rosterSheetsEnabled]: "true",
      [CLASSROOM_FEATURE_FLAG_ENV.studentLocalAuthEnabled]: "true",
      [CLASSROOM_FEATURE_FLAG_ENV.teacherDriveSubmissionEnabled]: "true",
      [CLASSROOM_FEATURE_FLAG_ENV.submissionPreviewEnabled]: "true",
    });
    expect(result.degradedToOff).toBe(false);
    expect(result.dependencyIssues).toEqual([]);
    expect(result.flags.submissionPreviewEnabled).toBe(true);
  });

  it("degrades all flags to OFF when dependency chain is invalid", () => {
    const warnings: string[] = [];
    const result = resolveClassroomFeatureFlagsForStartup(
      {
        [CLASSROOM_FEATURE_FLAG_ENV.teacherDriveSubmissionEnabled]: "true",
      },
      message => warnings.push(message),
    );
    expect(result.degradedToOff).toBe(true);
    expect(result.dependencyIssues.length).toBeGreaterThan(0);
    expect(result.flags).toEqual({
      classroomRosterEnabled: false,
      adminGoogleCredentialEnabled: false,
      rosterSheetsEnabled: false,
      studentLocalAuthEnabled: false,
      teacherDriveSubmissionEnabled: false,
      submissionPreviewEnabled: false,
    });
    expect(warnings.some(line => line.includes("degrading all classroom feature flags"))).toBe(
      true,
    );
  });

  it("defaults to all OFF when env is unset", () => {
    const warn = vi.fn();
    const result = resolveClassroomFeatureFlagsForStartup({}, warn);
    expect(result.degradedToOff).toBe(false);
    expect(result.flags.teacherDriveSubmissionEnabled).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("getClassroomFeatureFlagsForRuntime", () => {
  beforeEach(() => {
    resetClassroomFeatureFlagsCacheForTests();
  });

  it("throws when startup resolve was not called", () => {
    expect(() => getClassroomFeatureFlagsForRuntime()).toThrow(
      ClassroomFeatureFlagsNotInitializedError,
    );
  });

  it("returns cached flags after startup resolve", () => {
    resolveClassroomFeatureFlagsForStartup({});
    expect(getClassroomFeatureFlagsForRuntime().classroomRosterEnabled).toBe(false);
  });
});
