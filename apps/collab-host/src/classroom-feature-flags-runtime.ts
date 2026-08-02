import {
  parseClassroomFeatureFlags,
  validateClassroomFeatureFlagDependencies,
  type ClassroomFeatureFlags,
} from "@blocksync/classroom-access";

const ALL_FLAGS_OFF: ClassroomFeatureFlags = {
  classroomRosterEnabled: false,
  adminGoogleCredentialEnabled: false,
  rosterSheetsEnabled: false,
  studentLocalAuthEnabled: false,
  teacherDriveSubmissionEnabled: false,
  submissionPreviewEnabled: false,
};

export interface ResolvedClassroomFeatureFlags {
  flags: ClassroomFeatureFlags;
  dependencyIssues: readonly string[];
  degradedToOff: boolean;
}

export function resolveClassroomFeatureFlagsForStartup(
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = (message) => {
    console.warn(message);
  },
): ResolvedClassroomFeatureFlags {
  const parsed = parseClassroomFeatureFlags(env);
  const issues = validateClassroomFeatureFlagDependencies(parsed);
  if (issues.length === 0) {
    return {flags: parsed, dependencyIssues: [], degradedToOff: false};
  }
  for (const issue of issues) {
    warn(`[collab-host] classroom feature flag dependency invalid: ${issue}`);
  }
  warn("[collab-host] degrading all classroom feature flags to OFF");
  return {
    flags: ALL_FLAGS_OFF,
    dependencyIssues: issues,
    degradedToOff: true,
  };
}
