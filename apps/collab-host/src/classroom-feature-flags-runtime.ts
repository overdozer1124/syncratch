import {
  parseClassroomFeatureFlags,
  validateClassroomFeatureFlagDependencies,
  type ClassroomFeatureFlags,
} from "@blocksync/classroom-access";

let cachedStartupFlags: ResolvedClassroomFeatureFlags | null = null;

export function resetClassroomFeatureFlagsCacheForTests(): void {
  cachedStartupFlags = null;
}

const ALL_FLAGS_OFF: ClassroomFeatureFlags = {
  classroomRosterEnabled: false,
  adminGoogleCredentialEnabled: false,
  rosterSheetsEnabled: false,
  studentLocalAuthEnabled: false,
  rosterGoogleStudentAuthEnabled: false,
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
  if (cachedStartupFlags) {
    return cachedStartupFlags;
  }
  const parsed = parseClassroomFeatureFlags(env);
  const issues = validateClassroomFeatureFlagDependencies(parsed);
  if (issues.length === 0) {
    cachedStartupFlags = {flags: parsed, dependencyIssues: [], degradedToOff: false};
    return cachedStartupFlags;
  }
  for (const issue of issues) {
    warn(`[collab-host] classroom feature flag dependency invalid: ${issue}`);
  }
  warn("[collab-host] degrading all classroom feature flags to OFF");
  cachedStartupFlags = {
    flags: ALL_FLAGS_OFF,
    dependencyIssues: issues,
    degradedToOff: true,
  };
  return cachedStartupFlags;
}

export class ClassroomFeatureFlagsNotInitializedError extends Error {
  constructor() {
    super(
      "Classroom feature flags cache is not initialized; call resolveClassroomFeatureFlagsForStartup() at process startup first",
    );
    this.name = "ClassroomFeatureFlagsNotInitializedError";
  }
}

export function getClassroomFeatureFlagsForRuntime(): ClassroomFeatureFlags {
  if (!cachedStartupFlags) {
    throw new ClassroomFeatureFlagsNotInitializedError();
  }
  return cachedStartupFlags.flags;
}
