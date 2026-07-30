export type {
  AdminAccount,
  AdminAccountStatus,
  ClassroomAiAssistPolicy,
  ClassroomAiLevel,
  ClassroomCollabPolicy,
  ClassroomDrivePolicy,
  ClassroomEditorPolicy,
  ClassroomPolicy,
  ClassroomPolicyInput,
  ClassroomPolicyStatus,
  StudentLink,
  StudentLinkListItem,
  StudentLinkStatus,
  StudentPolicyView,
  SurfaceMode,
} from "./types.js";

export {
  DEFAULT_CLASSROOM_POLICY_INPUT,
  mergeClassroomPolicy,
  normalizeClassroomPolicyInput,
  toStudentPolicyView,
  type NormalizedClassroomPolicyFields,
} from "./policy.js";

export {
  createOpaqueId,
  createStudentLinkToken,
  isPlausibleStudentToken,
  type RandomBytes,
} from "./tokens.js";

export {
  ADMIN_API_PREFIX,
  ADMIN_AUTH_GOOGLE_PATH,
  ADMIN_AUTH_LOGOUT_PATH,
  ADMIN_AUTH_STATUS_PATH,
  ADMIN_LINKS_PATH,
  ADMIN_ME_PATH,
  ADMIN_POLICIES_PATH,
  ADMIN_SURFACE_PATH,
  STUDENT_POLICY_BY_TOKEN_PREFIX,
  adminLinkPath,
  adminLinkReissuePath,
  adminLinkRevokePath,
  adminLinksForPolicyPath,
  adminPolicyPath,
  studentPolicyByTokenPath,
  studentSurfacePath,
} from "./paths.js";

export {resolveSurfaceMode} from "./surface-mode.js";

export {
  isEmailAllowlisted,
  normalizeEmail,
  parseAdminEmailAllowlist,
} from "./email.js";
