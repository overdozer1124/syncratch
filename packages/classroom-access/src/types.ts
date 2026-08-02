import type {StudentAuthPolicy, SubmissionPolicy} from "./roster-types.js";

/** Utilization levels aligned with @blocksync/ai-assist (0–6). */
export type ClassroomAiLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type ClassroomPolicyStatus = "active" | "disabled";
export type StudentLinkStatus = "active" | "revoked";
export type AdminAccountStatus = "active" | "disabled";

export interface ClassroomAiAssistPolicy {
  enabled: boolean;
  /** Maximum AI level students may use when AI is enabled. */
  level: ClassroomAiLevel;
  /** When false (default), students cannot enter their own API key. */
  allowStudentApiKey: boolean;
}

export interface ClassroomEditorPolicy {
  showSettingsPanel: boolean;
  allowSb3Export: boolean;
  allowSb3Import: boolean;
  /** When false, block Scratch standard and Syncratch extension galleries. */
  allowExtensions: boolean;
}

export interface ClassroomCollabPolicy {
  allow: boolean;
}

export interface ClassroomDrivePolicy {
  allow: boolean;
}

/** Server-owned classroom policy (admin CRUD). */
export interface ClassroomPolicy {
  policyId: string;
  ownerAdminId: string;
  title: string;
  status: ClassroomPolicyStatus;
  /** Linked roster for roster-login mode (PR 5+). Null keeps shared-anonymous. */
  rosterId: string | null;
  studentAuth: StudentAuthPolicy;
  submission: SubmissionPolicy;
  aiAssist: ClassroomAiAssistPolicy;
  editor: ClassroomEditorPolicy;
  collab: ClassroomCollabPolicy;
  drive: ClassroomDrivePolicy;
  createdAt: string;
  updatedAt: string;
}

/** Fields an admin may set on create/update (no ids / ownership / timestamps). */
export interface ClassroomPolicyInput {
  title?: string;
  status?: ClassroomPolicyStatus;
  rosterId?: string | null;
  studentAuth?: Partial<StudentAuthPolicy>;
  submission?: Partial<SubmissionPolicy>;
  aiAssist?: Partial<ClassroomAiAssistPolicy>;
  editor?: Partial<ClassroomEditorPolicy>;
  collab?: Partial<ClassroomCollabPolicy>;
  drive?: Partial<ClassroomDrivePolicy>;
}

/**
 * Minimal policy view returned to student clients.
 * Must never include admin secrets, emails, or other link tokens.
 */
export interface StudentPolicyView {
  policyId: string;
  title: string;
  studentAuth: StudentAuthPolicy;
  submission: SubmissionPolicy;
  aiAssist: ClassroomAiAssistPolicy;
  editor: ClassroomEditorPolicy;
  collab: ClassroomCollabPolicy;
  drive: ClassroomDrivePolicy;
}

export interface StudentLink {
  linkId: string;
  policyId: string;
  ownerAdminId: string;
  /** Opaque high-entropy secret used in `/s/{token}`. */
  token: string;
  label: string;
  status: StudentLinkStatus;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

/** List row for admin UI — token is omitted except at create/reissue time. */
export interface StudentLinkListItem {
  linkId: string;
  policyId: string;
  label: string;
  status: StudentLinkStatus;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
  /** Present only on create / reissue responses. */
  token?: string;
  studentUrl?: string;
}

export interface AdminAccount {
  adminId: string;
  subject: string;
  email: string;
  displayName: string | null;
  status: AdminAccountStatus;
  createdAt: string;
  updatedAt: string;
}

export type SurfaceMode =
  | {kind: "community"}
  | {kind: "admin"}
  /** Student surface. `token` present on `/s/{token}` before grant exchange; absent on `/s`. */
  | {kind: "student"; token?: string};
