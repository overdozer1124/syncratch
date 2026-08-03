import type {StudentAccessMode} from "./roster-types.js";
import type {
  ClassroomAiAssistPolicy,
  ClassroomAiLevel,
  ClassroomCollabPolicy,
  ClassroomDrivePolicy,
  ClassroomEditorPolicy,
  ClassroomPolicy,
  ClassroomPolicyInput,
  ClassroomPolicyStatus,
  StudentPolicyView,
} from "./types.js";

export interface StudentPolicyViewOptions {
  /** When false, student clients always see shared-anonymous (Phase 2 compat). */
  classroomRosterEnabled?: boolean;
}

export interface NormalizedClassroomPolicyFields {
  title: string;
  status: ClassroomPolicyStatus;
  rosterId: string | null;
  studentAuth: ClassroomPolicy["studentAuth"];
  submission: ClassroomPolicy["submission"];
  aiAssist: ClassroomAiAssistPolicy;
  editor: ClassroomEditorPolicy;
  collab: ClassroomCollabPolicy;
  drive: ClassroomDrivePolicy;
}

export const DEFAULT_CLASSROOM_POLICY_INPUT: NormalizedClassroomPolicyFields = {
  title: "新しい教室設定",
  status: "active",
  rosterId: null,
  studentAuth: {required: false},
  submission: {enabled: false},
  aiAssist: {
    enabled: false,
    level: 2,
    allowStudentApiKey: false,
  },
  editor: {
    showSettingsPanel: false,
    allowSb3Export: true,
    allowSb3Import: true,
    allowExtensions: false,
  },
  collab: {allow: true},
  drive: {allow: false},
};

function clampAiLevel(value: unknown): ClassroomAiLevel {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 2;
  const clamped = Math.min(6, Math.max(0, Math.trunc(n)));
  return clamped as ClassroomAiLevel;
}

function asStatus(value: unknown): ClassroomPolicyStatus {
  return value === "disabled" ? "disabled" : "active";
}

export function normalizeClassroomPolicyInput(
  input: ClassroomPolicyInput | null | undefined,
): NormalizedClassroomPolicyFields {
  const base = DEFAULT_CLASSROOM_POLICY_INPUT;
  const title =
    typeof input?.title === "string" && input.title.trim()
      ? input.title.trim().slice(0, 120)
      : base.title;
  return {
    title,
    status: asStatus(input?.status ?? base.status),
    rosterId:
      input?.rosterId === undefined
        ? base.rosterId
        : input.rosterId === null
          ? null
          : typeof input.rosterId === "string" && input.rosterId.trim()
            ? input.rosterId.trim()
            : null,
    studentAuth: {
      required: Boolean(
        input?.studentAuth?.required ?? base.studentAuth.required,
      ),
    },
    submission: {
      enabled: Boolean(
        input?.submission?.enabled ?? base.submission.enabled,
      ),
    },
    aiAssist: {
      enabled: Boolean(input?.aiAssist?.enabled ?? base.aiAssist.enabled),
      level: clampAiLevel(input?.aiAssist?.level ?? base.aiAssist.level),
      allowStudentApiKey: Boolean(
        input?.aiAssist?.allowStudentApiKey ?? base.aiAssist.allowStudentApiKey,
      ),
    },
    editor: {
      showSettingsPanel: Boolean(
        input?.editor?.showSettingsPanel ?? base.editor.showSettingsPanel,
      ),
      allowSb3Export: Boolean(
        input?.editor?.allowSb3Export ?? base.editor.allowSb3Export,
      ),
      allowSb3Import: Boolean(
        input?.editor?.allowSb3Import ?? base.editor.allowSb3Import,
      ),
      allowExtensions: Boolean(
        input?.editor?.allowExtensions ?? base.editor.allowExtensions,
      ),
    },
    collab: {
      allow: Boolean(input?.collab?.allow ?? base.collab.allow),
    },
    drive: {
      allow: Boolean(input?.drive?.allow ?? base.drive.allow),
    },
  };
}

export function mergeClassroomPolicy(
  existing: ClassroomPolicy,
  patch: ClassroomPolicyInput,
  updatedAt: string,
): ClassroomPolicy {
  const normalized = normalizeClassroomPolicyInput({
    title: patch.title ?? existing.title,
    status: patch.status ?? existing.status,
    rosterId: patch.rosterId !== undefined ? patch.rosterId : existing.rosterId,
    studentAuth: {...existing.studentAuth, ...patch.studentAuth},
    submission: {...existing.submission, ...patch.submission},
    aiAssist: {...existing.aiAssist, ...patch.aiAssist},
    editor: {...existing.editor, ...patch.editor},
    collab: {...existing.collab, ...patch.collab},
    drive: {...existing.drive, ...patch.drive},
  });
  return {
    policyId: existing.policyId,
    ownerAdminId: existing.ownerAdminId,
    createdAt: existing.createdAt,
    ...normalized,
    updatedAt,
  };
}

export function resolveStudentAccessMode(
  policy: Pick<ClassroomPolicy, "rosterId" | "studentAuth">,
  options?: StudentPolicyViewOptions,
): StudentAccessMode {
  if (options?.classroomRosterEnabled === false) return "shared-anonymous";
  if (policy.rosterId && policy.studentAuth.required) return "roster-login";
  return "shared-anonymous";
}

/** Strip privileged fields before sending to student clients. */
export function toStudentPolicyView(
  policy: ClassroomPolicy,
  options?: StudentPolicyViewOptions,
): StudentPolicyView {
  const studentAuth =
    options?.classroomRosterEnabled === false
      ? {required: false}
      : {...policy.studentAuth};
  return {
    policyId: policy.policyId,
    title: policy.title,
    studentAuth,
    submission: {...policy.submission},
    aiAssist: {...policy.aiAssist},
    editor: {...policy.editor},
    collab: {...policy.collab},
    drive: {...policy.drive},
  };
}
