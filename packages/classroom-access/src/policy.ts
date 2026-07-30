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

export interface NormalizedClassroomPolicyFields {
  title: string;
  status: ClassroomPolicyStatus;
  aiAssist: ClassroomAiAssistPolicy;
  editor: ClassroomEditorPolicy;
  collab: ClassroomCollabPolicy;
  drive: ClassroomDrivePolicy;
}

export const DEFAULT_CLASSROOM_POLICY_INPUT: NormalizedClassroomPolicyFields = {
  title: "新しい教室設定",
  status: "active",
  aiAssist: {
    enabled: false,
    level: 2,
    allowStudentApiKey: false,
  },
  editor: {
    showSettingsPanel: false,
    allowSb3Export: true,
    allowSb3Import: true,
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

/** Strip privileged fields before sending to student clients. */
export function toStudentPolicyView(policy: ClassroomPolicy): StudentPolicyView {
  return {
    policyId: policy.policyId,
    title: policy.title,
    aiAssist: {...policy.aiAssist},
    editor: {...policy.editor},
    collab: {...policy.collab},
    drive: {...policy.drive},
  };
}
