import type {StudentPolicyView} from "@blocksync/classroom-access";
import {
  DEFAULT_AI_SETTINGS,
  type AiAssistSettings,
} from "@blocksync/ai-assist";
import {
  CLASSROOM_DRIVE_BLOCKED_HELP,
  CLASSROOM_DRIVE_BLOCKED_STATUS,
} from "./ui-copy.js";

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
  driveStatus?: HTMLElement | null;
  driveSectionHelp?: HTMLElement | null;
  driveControls?: HTMLElement | null;
  drivePanel?: HTMLElement | null;
  collabPanel?: HTMLElement | null;
  filePanel?: HTMLElement | null;
}

/**
 * Hide Drive CTAs only when both Drive and collab are disallowed.
 * Collab-enabled student links still need Drive controls for the host
 * (Stage 5 A5: only the invite creator writes Drive).
 */
export function shouldHideStudentDriveControls(
  policy: StudentPolicyView,
): boolean {
  return !policy.drive.allow && !policy.collab.allow;
}

export function isStudentDriveFullyBlocked(policy: StudentPolicyView): boolean {
  return shouldHideStudentDriveControls(policy);
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

function applyStudentDrivePolicyMessaging(
  policy: StudentPolicyView,
  dom: ClassroomDomHooks,
): void {
  if (!shouldHideStudentDriveControls(policy)) return;
  if (dom.driveStatus) {
    dom.driveStatus.textContent = CLASSROOM_DRIVE_BLOCKED_STATUS;
    dom.driveStatus.title = CLASSROOM_DRIVE_BLOCKED_STATUS;
  }
  if (dom.driveSectionHelp) {
    dom.driveSectionHelp.textContent = CLASSROOM_DRIVE_BLOCKED_HELP;
  }
  if (dom.driveControls) {
    dom.driveControls.hidden = true;
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

  if (shouldHideStudentDriveControls(policy)) {
    for (const el of [
      dom.connectGoogleButton,
      dom.openDriveButton,
      dom.saveDriveButton,
      dom.disconnectGoogleButton,
      dom.drivePanel,
    ]) {
      if (el) el.hidden = true;
    }
    applyStudentDrivePolicyMessaging(policy, dom);
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
