import type {StudentPolicyView} from "@blocksync/classroom-access";
import {
  DEFAULT_AI_SETTINGS,
  type AiAssistSettings,
} from "@blocksync/ai-assist";

export interface ClassroomDomHooks {
  settingsPanel: HTMLElement | null;
  aiPanel: HTMLElement | null;
  aiEnabledInput: HTMLInputElement | null;
  aiApiKeyInput: HTMLInputElement | null;
  aiSettingsSaveButton: HTMLElement | null;
  downloadButton: HTMLElement | null;
  openButton: HTMLElement | null;
  fileInput: HTMLElement | null;
  connectGoogleButton: HTMLElement | null;
  openDriveButton: HTMLElement | null;
  saveDriveButton: HTMLElement | null;
  disconnectGoogleButton: HTMLElement | null;
  createRoomButton: HTMLElement | null;
  joinRoomButton: HTMLElement | null;
  copyInviteButton: HTMLElement | null;
  collabInviteInput: HTMLElement | null;
  drivePanel?: HTMLElement | null;
  collabPanel?: HTMLElement | null;
  filePanel?: HTMLElement | null;
}

/**
 * Build in-memory AI settings for student mode.
 * Ignores contradictory localStorage values.
 */
export function aiSettingsFromStudentPolicy(
  policy: StudentPolicyView,
): AiAssistSettings {
  return {
    ...DEFAULT_AI_SETTINGS,
    enabled: policy.aiAssist.enabled,
    level: policy.aiAssist.level,
    apiKey: "",
    modelOverride: "",
    providerOverride: "",
  };
}

function closeDetails(el: HTMLElement): void {
  el.hidden = true;
  if ("open" in el) {
    (el as HTMLDetailsElement).open = false;
  }
}

/** Apply classroom policy locks to editor chrome (student mode). */
export function applyStudentPolicyToDom(
  policy: StudentPolicyView,
  dom: ClassroomDomHooks,
): void {
  if (!policy.editor.showSettingsPanel && dom.settingsPanel) {
    closeDetails(dom.settingsPanel);
  }

  if (!policy.aiAssist.enabled && dom.aiPanel) {
    closeDetails(dom.aiPanel);
  }

  if (!policy.aiAssist.allowStudentApiKey) {
    if (dom.aiEnabledInput) {
      dom.aiEnabledInput.disabled = true;
    }
    if (dom.aiApiKeyInput) {
      dom.aiApiKeyInput.disabled = true;
      dom.aiApiKeyInput.value = "";
    }
    if (dom.aiSettingsSaveButton) {
      dom.aiSettingsSaveButton.hidden = true;
    }
  }

  if (!policy.editor.allowSb3Export && dom.downloadButton) {
    dom.downloadButton.hidden = true;
  }
  if (!policy.editor.allowSb3Import) {
    if (dom.openButton) dom.openButton.hidden = true;
    if (dom.fileInput) dom.fileInput.hidden = true;
  }

  if (!policy.drive.allow) {
    for (const el of [
      dom.connectGoogleButton,
      dom.openDriveButton,
      dom.saveDriveButton,
      dom.disconnectGoogleButton,
      dom.drivePanel,
    ]) {
      if (el) el.hidden = true;
    }
  }

  if (!policy.collab.allow) {
    for (const el of [
      dom.createRoomButton,
      dom.joinRoomButton,
      dom.copyInviteButton,
      dom.collabInviteInput,
      dom.collabPanel,
    ]) {
      if (el) el.hidden = true;
    }
  }
}

export function studentPolicyBlocksAiPersist(policy: StudentPolicyView): boolean {
  return !policy.aiAssist.allowStudentApiKey;
}
