/** Admin and student HTTP API paths (collab-host). */
export const ADMIN_API_PREFIX = "/api/admin";
export const ADMIN_ME_PATH = `${ADMIN_API_PREFIX}/me`;
export const ADMIN_CLASSROOM_FLAGS_PATH = `${ADMIN_API_PREFIX}/classroom-flags`;
export const ADMIN_AUTH_GOOGLE_PATH = `${ADMIN_API_PREFIX}/auth/google`;
export const ADMIN_AUTH_LOGOUT_PATH = `${ADMIN_API_PREFIX}/auth/logout`;
export const ADMIN_AUTH_STATUS_PATH = `${ADMIN_API_PREFIX}/auth/status`;
export const ADMIN_POLICIES_PATH = `${ADMIN_API_PREFIX}/policies`;
export const ADMIN_LINKS_PATH = `${ADMIN_API_PREFIX}/links`;
export const ADMIN_ROSTERS_PATH = `${ADMIN_API_PREFIX}/rosters`;
export const ADMIN_STUDENTS_PATH = `${ADMIN_API_PREFIX}/students`;
export const ADMIN_GOOGLE_OAUTH_PREFIX = `${ADMIN_API_PREFIX}/google/oauth`;
export const ADMIN_GOOGLE_OAUTH_START_PATH = `${ADMIN_GOOGLE_OAUTH_PREFIX}/start`;
export const ADMIN_GOOGLE_OAUTH_SESSION_PATH = `${ADMIN_GOOGLE_OAUTH_PREFIX}/session`;
export const ADMIN_GOOGLE_OAUTH_DISCONNECT_PATH = `${ADMIN_GOOGLE_OAUTH_PREFIX}/disconnect`;
export const ADMIN_GOOGLE_OAUTH_CALLBACK_PATH = "/oauth/admin-google/callback";
/** Query param on /admin after OAuth redirect (`ok` | `error`). */
export const ADMIN_GOOGLE_OAUTH_RETURN_FLAG = "admin_google_oauth";
/** Optional detail code on /admin after OAuth redirect failure. */
export const ADMIN_GOOGLE_OAUTH_RETURN_REASON = "admin_google_oauth_reason";

export const STUDENT_AUTH_PREFIX = "/api/student/auth";
export const STUDENT_AUTH_ACTIVATE_PATH = `${STUDENT_AUTH_PREFIX}/activate`;
export const STUDENT_AUTH_LOGIN_PATH = `${STUDENT_AUTH_PREFIX}/login`;
export const STUDENT_AUTH_SESSION_PATH = `${STUDENT_AUTH_PREFIX}/session`;
export const STUDENT_AUTH_LOGOUT_PATH = `${STUDENT_AUTH_PREFIX}/logout`;
export const STUDENT_SUBMISSIONS_PATH = "/api/student/submissions";

export const STUDENT_POLICY_BY_TOKEN_PREFIX = "/api/student/policy-by-token";
export const STUDENT_GRANT_PATH = "/api/student/grant";
export const STUDENT_POLICY_PATH = "/api/student/policy";
export const STUDENT_SURFACE_SESSION_PATH = "/s";

export function adminPolicyPath(policyId: string): string {
  return `${ADMIN_POLICIES_PATH}/${encodeURIComponent(policyId)}`;
}

export function adminLinksForPolicyPath(policyId: string): string {
  return `${ADMIN_POLICIES_PATH}/${encodeURIComponent(policyId)}/links`;
}

export function adminLinkPath(linkId: string): string {
  return `${ADMIN_LINKS_PATH}/${encodeURIComponent(linkId)}`;
}

export function adminLinkRevokePath(linkId: string): string {
  return `${adminLinkPath(linkId)}/revoke`;
}

export function adminLinkReissuePath(linkId: string): string {
  return `${adminLinkPath(linkId)}/reissue`;
}

export function adminRosterPath(rosterId: string): string {
  return `${ADMIN_ROSTERS_PATH}/${encodeURIComponent(rosterId)}`;
}

export function adminRosterStudentsPath(rosterId: string): string {
  return `${adminRosterPath(rosterId)}/students`;
}

export function adminRosterSyncPath(rosterId: string): string {
  return `${adminRosterPath(rosterId)}/sync`;
}

export function adminRosterSyncApplyPath(rosterId: string): string {
  return `${adminRosterSyncPath(rosterId)}/apply`;
}

export function adminRosterImportsPath(rosterId: string): string {
  return `${adminRosterPath(rosterId)}/imports`;
}

export function adminRosterImportPath(rosterId: string, importId: string): string {
  return `${adminRosterImportsPath(rosterId)}/${encodeURIComponent(importId)}`;
}

export function adminRosterImportPreviewPath(
  rosterId: string,
  importId: string,
): string {
  return `${adminRosterImportPath(rosterId, importId)}/preview`;
}

export function adminRosterImportApplyPath(
  rosterId: string,
  importId: string,
): string {
  return `${adminRosterImportPath(rosterId, importId)}/apply`;
}

export function adminStudentPath(studentId: string): string {
  return `${ADMIN_STUDENTS_PATH}/${encodeURIComponent(studentId)}`;
}

export function adminStudentEnrollmentCodePath(studentId: string): string {
  return `${adminStudentPath(studentId)}/enrollment-code`;
}

export function adminStudentResetCodePath(studentId: string): string {
  return `${adminStudentPath(studentId)}/reset-code`;
}

export function adminStudentRevokeSessionsPath(studentId: string): string {
  return `${adminStudentPath(studentId)}/sessions/revoke`;
}

export function adminPolicySubmissionsPath(policyId: string): string {
  return `${adminPolicyPath(policyId)}/submissions`;
}

export function adminSubmissionPath(submissionId: string): string {
  return `${ADMIN_API_PREFIX}/submissions/${encodeURIComponent(submissionId)}`;
}

export function adminSubmissionContentPath(submissionId: string): string {
  return `${adminSubmissionPath(submissionId)}/content`;
}

export function adminSubmissionPreviewSurfacePath(submissionId: string): string {
  return `/admin/submissions/${encodeURIComponent(submissionId)}/preview`;
}

export function studentPolicyByTokenPath(token: string): string {
  return `${STUDENT_POLICY_BY_TOKEN_PREFIX}/${encodeURIComponent(token)}`;
}

export function studentSurfacePath(token: string): string {
  return `/s/${encodeURIComponent(token)}`;
}

export const ADMIN_SURFACE_PATH = "/admin";
