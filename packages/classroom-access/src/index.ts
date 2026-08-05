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

export type {
  ClassroomRoster,
  ClassroomRosterInput,
  ClassroomRosterListItem,
  ClassroomRosterSyncStatus,
  ClassroomStudent,
  ClassroomStudentInput,
  ClassroomStudentListItem,
  RosterImport,
  RosterImportPreview,
  RosterImportPreviewCategory,
  RosterImportPreviewRow,
  RosterImportRowIssue,
  RosterImportStatus,
  RosterMembership,
  RosterSheetColumn,
  RosterSyncResult,
  StudentAccessMode,
  StudentAccountStatus,
  StudentAuthMethod,
  StudentAuthPolicy,
  StudentAuthClientPolicy,
  SubmissionDetail,
  SubmissionListItem,
  SubmissionPolicy,
  SubmissionStatus,
} from "./roster-types.js";

export {
  ROSTER_SHEET_COLUMNS,
  ROSTER_SHEET_COLUMN_LABELS,
  ROSTER_SHEET_HEADER_ALIASES,
  canonicalRosterSheetHeader,
  rosterSheetTemplateHeaders,
} from "./roster-types.js";

export {
  emailDomain,
  isStudentEmailDomainAllowed,
  normalizeAllowedEmailDomains,
  normalizeGoogleEmail,
  normalizeStudentAuthMethod,
  parseAllowedEmailDomainsJson,
  studentAuthMethodIncludesGoogle,
  studentAuthMethodIncludesLocal,
} from "./roster-auth.js";

export {
  DEFAULT_CLASSROOM_POLICY_INPUT,
  mergeClassroomPolicy,
  normalizeClassroomPolicyInput,
  resolveStudentAccessMode,
  toStudentPolicyView,
  type NormalizedClassroomPolicyFields,
  type StudentPolicyViewOptions,
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
  ADMIN_GOOGLE_OAUTH_CALLBACK_PATH,
  ADMIN_GOOGLE_OAUTH_DISCONNECT_PATH,
  ADMIN_GOOGLE_OAUTH_PREFIX,
  ADMIN_GOOGLE_OAUTH_RETURN_FLAG,
  ADMIN_GOOGLE_OAUTH_RETURN_REASON,
  ADMIN_GOOGLE_OAUTH_SESSION_PATH,
  ADMIN_GOOGLE_OAUTH_START_PATH,
  ADMIN_LINKS_PATH,
  ADMIN_ME_PATH,
  ADMIN_CLASSROOM_FLAGS_PATH,
  ADMIN_POLICIES_PATH,
  ADMIN_ROSTERS_PATH,
  ADMIN_STUDENTS_PATH,
  ADMIN_SURFACE_PATH,
  STUDENT_AUTH_ACTIVATE_PATH,
  STUDENT_AUTH_LOGIN_PATH,
  STUDENT_AUTH_LOGOUT_PATH,
  STUDENT_AUTH_PREFIX,
  STUDENT_AUTH_SESSION_PATH,
  STUDENT_POLICY_BY_TOKEN_PREFIX,
  STUDENT_GRANT_PATH,
  STUDENT_POLICY_PATH,
  STUDENT_SUBMISSIONS_PATH,
  STUDENT_SURFACE_SESSION_PATH,
  adminLinkPath,
  adminLinkReissuePath,
  adminLinkRevokePath,
  adminLinksForPolicyPath,
  adminPolicyPath,
  adminPolicySubmissionsPath,
  adminRosterImportApplyPath,
  adminRosterImportPath,
  adminRosterImportPreviewPath,
  adminRosterImportsPath,
  adminRosterPath,
  adminRosterStudentsPath,
  adminRosterSheetTemplatePath,
  adminRosterSyncPath,
  adminRosterSyncApplyPath,
  adminStudentEnrollmentCodePath,
  adminStudentPath,
  adminStudentResetCodePath,
  adminStudentRevokeSessionsPath,
  adminSubmissionContentPath,
  adminSubmissionPath,
  adminSubmissionPreviewSurfacePath,
  studentPolicyByTokenPath,
  studentSurfacePath,
} from "./paths.js";

export {resolveSurfaceMode} from "./surface-mode.js";

export {
  isLinkExpiresAtInPast,
  parseLinkExpiresAt,
} from "./link-expiry.js";

export {
  isEmailAllowlisted,
  normalizeEmail,
  parseAdminEmailAllowlist,
} from "./email.js";

export {
  CLASSROOM_FEATURE_FLAG_ENV,
  parseClassroomFeatureFlags,
  validateClassroomFeatureFlagDependencies,
  type ClassroomFeatureFlags,
} from "./feature-flags.js";
