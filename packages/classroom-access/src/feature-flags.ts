/** Runtime feature flags for classroom roster / submission (all default OFF). */

export interface ClassroomFeatureFlags {
  classroomRosterEnabled: boolean;
  adminGoogleCredentialEnabled: boolean;
  rosterSheetsEnabled: boolean;
  studentLocalAuthEnabled: boolean;
  rosterGoogleStudentAuthEnabled: boolean;
  teacherDriveSubmissionEnabled: boolean;
  submissionPreviewEnabled: boolean;
}

export const CLASSROOM_FEATURE_FLAG_ENV = {
  classroomRosterEnabled: "SYNCRATCH_CLASSROOM_ROSTER_ENABLED",
  adminGoogleCredentialEnabled: "SYNCRATCH_ADMIN_GOOGLE_CREDENTIAL_ENABLED",
  rosterSheetsEnabled: "SYNCRATCH_ROSTER_SHEETS_ENABLED",
  studentLocalAuthEnabled: "SYNCRATCH_STUDENT_LOCAL_AUTH_ENABLED",
  rosterGoogleStudentAuthEnabled: "SYNCRATCH_ROSTER_GOOGLE_STUDENT_AUTH_ENABLED",
  teacherDriveSubmissionEnabled: "SYNCRATCH_TEACHER_DRIVE_SUBMISSION_ENABLED",
  submissionPreviewEnabled: "SYNCRATCH_SUBMISSION_PREVIEW_ENABLED",
} as const;

function parseEnvFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function parseClassroomFeatureFlags(
  env: NodeJS.ProcessEnv = process.env,
): ClassroomFeatureFlags {
  return {
    classroomRosterEnabled: parseEnvFlag(
      env[CLASSROOM_FEATURE_FLAG_ENV.classroomRosterEnabled],
    ),
    adminGoogleCredentialEnabled: parseEnvFlag(
      env[CLASSROOM_FEATURE_FLAG_ENV.adminGoogleCredentialEnabled],
    ),
    rosterSheetsEnabled: parseEnvFlag(
      env[CLASSROOM_FEATURE_FLAG_ENV.rosterSheetsEnabled],
    ),
    studentLocalAuthEnabled: parseEnvFlag(
      env[CLASSROOM_FEATURE_FLAG_ENV.studentLocalAuthEnabled],
    ),
    rosterGoogleStudentAuthEnabled: parseEnvFlag(
      env[CLASSROOM_FEATURE_FLAG_ENV.rosterGoogleStudentAuthEnabled],
    ),
    teacherDriveSubmissionEnabled: parseEnvFlag(
      env[CLASSROOM_FEATURE_FLAG_ENV.teacherDriveSubmissionEnabled],
    ),
    submissionPreviewEnabled: parseEnvFlag(
      env[CLASSROOM_FEATURE_FLAG_ENV.submissionPreviewEnabled],
    ),
  };
}

/** Fail closed when a flag is on but its dependency chain is incomplete. */
export function validateClassroomFeatureFlagDependencies(
  flags: ClassroomFeatureFlags,
): string[] {
  const issues: string[] = [];
  if (flags.adminGoogleCredentialEnabled && !flags.classroomRosterEnabled) {
    issues.push(
      "SYNCRATCH_ADMIN_GOOGLE_CREDENTIAL_ENABLED requires SYNCRATCH_CLASSROOM_ROSTER_ENABLED",
    );
  }
  if (flags.rosterSheetsEnabled && !flags.adminGoogleCredentialEnabled) {
    issues.push(
      "SYNCRATCH_ROSTER_SHEETS_ENABLED requires SYNCRATCH_ADMIN_GOOGLE_CREDENTIAL_ENABLED",
    );
  }
  if (flags.studentLocalAuthEnabled && !flags.classroomRosterEnabled) {
    issues.push(
      "SYNCRATCH_STUDENT_LOCAL_AUTH_ENABLED requires SYNCRATCH_CLASSROOM_ROSTER_ENABLED",
    );
  }
  if (flags.rosterGoogleStudentAuthEnabled && !flags.studentLocalAuthEnabled) {
    issues.push(
      "SYNCRATCH_ROSTER_GOOGLE_STUDENT_AUTH_ENABLED requires SYNCRATCH_STUDENT_LOCAL_AUTH_ENABLED",
    );
  }
  if (flags.rosterGoogleStudentAuthEnabled && !flags.classroomRosterEnabled) {
    issues.push(
      "SYNCRATCH_ROSTER_GOOGLE_STUDENT_AUTH_ENABLED requires SYNCRATCH_CLASSROOM_ROSTER_ENABLED",
    );
  }
  if (flags.teacherDriveSubmissionEnabled && !flags.studentLocalAuthEnabled) {
    issues.push(
      "SYNCRATCH_TEACHER_DRIVE_SUBMISSION_ENABLED requires SYNCRATCH_STUDENT_LOCAL_AUTH_ENABLED",
    );
  }
  if (flags.submissionPreviewEnabled && !flags.teacherDriveSubmissionEnabled) {
    issues.push(
      "SYNCRATCH_SUBMISSION_PREVIEW_ENABLED requires SYNCRATCH_TEACHER_DRIVE_SUBMISSION_ENABLED",
    );
  }
  return issues;
}
