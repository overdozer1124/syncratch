/** Admin and student HTTP API paths (collab-host). */
export const ADMIN_API_PREFIX = "/api/admin";
export const ADMIN_ME_PATH = `${ADMIN_API_PREFIX}/me`;
export const ADMIN_AUTH_GOOGLE_PATH = `${ADMIN_API_PREFIX}/auth/google`;
export const ADMIN_AUTH_LOGOUT_PATH = `${ADMIN_API_PREFIX}/auth/logout`;
export const ADMIN_AUTH_STATUS_PATH = `${ADMIN_API_PREFIX}/auth/status`;
export const ADMIN_POLICIES_PATH = `${ADMIN_API_PREFIX}/policies`;
export const ADMIN_LINKS_PATH = `${ADMIN_API_PREFIX}/links`;

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

export function studentPolicyByTokenPath(token: string): string {
  return `${STUDENT_POLICY_BY_TOKEN_PREFIX}/${encodeURIComponent(token)}`;
}

export function studentSurfacePath(token: string): string {
  return `/s/${encodeURIComponent(token)}`;
}

export const ADMIN_SURFACE_PATH = "/admin";
