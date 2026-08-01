import {describe, expect, it} from "vitest";
import type {StudentPolicyView} from "@blocksync/classroom-access";
import {
  aiSettingsFromStudentPolicy,
  applyStudentPolicyToDom,
  studentPolicyBlocksAiPersist,
} from "./classroom-policy-apply.js";

function policy(overrides: Partial<StudentPolicyView> = {}): StudentPolicyView {
  return {
    policyId: "p1",
    title: "class",
    aiAssist: {enabled: false, level: 2, allowStudentApiKey: false},
    editor: {
      showSettingsPanel: false,
      allowSb3Export: true,
      allowSb3Import: true,
    },
    collab: {allow: true},
    drive: {allow: false},
    ...overrides,
  };
}

describe("classroom policy apply", () => {
  it("forces AI off from policy even if localStorage would enable it", () => {
    const settings = aiSettingsFromStudentPolicy(
      policy({
        aiAssist: {enabled: false, level: 2, allowStudentApiKey: false},
      }),
    );
    expect(settings.enabled).toBe(false);
    expect(settings.apiKey).toBe("");
    expect(studentPolicyBlocksAiPersist(policy())).toBe(true);
  });

  it("hides settings and AI panel when policy locks them", () => {
    const settingsPanel = {hidden: false} as HTMLElement;
    const aiPanel = {hidden: false} as HTMLElement;
    applyStudentPolicyToDom(policy(), {
      settingsPanel,
      aiPanel,
      aiEnabledInput: null,
      aiApiKeyInput: null,
      aiSettingsSaveButton: null,
      downloadButton: null,
      openButton: null,
      fileInput: null,
      connectGoogleButton: null,
      openDriveButton: null,
      saveDriveButton: null,
      disconnectGoogleButton: null,
      createRoomButton: null,
      joinRoomButton: null,
      copyInviteButton: null,
      collabInviteInput: null,
    });
    expect(settingsPanel.hidden).toBe(true);
    expect(aiPanel.hidden).toBe(true);
  });

  it("hides Drive CTAs when drive.allow is false (intentional student lock)", () => {
    const connectGoogleButton = {hidden: false} as HTMLElement;
    const openDriveButton = {hidden: false} as HTMLElement;
    const saveDriveButton = {hidden: false} as HTMLElement;
    const disconnectGoogleButton = {hidden: false} as HTMLElement;
    applyStudentPolicyToDom(policy({drive: {allow: false}}), {
      settingsPanel: null,
      aiPanel: null,
      aiEnabledInput: null,
      aiApiKeyInput: null,
      aiSettingsSaveButton: null,
      downloadButton: null,
      openButton: null,
      fileInput: null,
      connectGoogleButton,
      openDriveButton,
      saveDriveButton,
      disconnectGoogleButton,
      createRoomButton: null,
      joinRoomButton: null,
      copyInviteButton: null,
      collabInviteInput: null,
    });
    expect(connectGoogleButton.hidden).toBe(true);
    expect(openDriveButton.hidden).toBe(true);
    expect(saveDriveButton.hidden).toBe(true);
    expect(disconnectGoogleButton.hidden).toBe(true);
  });

  it("keeps Drive CTAs visible when drive.allow is true", () => {
    const saveDriveButton = {hidden: false} as HTMLElement;
    applyStudentPolicyToDom(policy({drive: {allow: true}}), {
      settingsPanel: null,
      aiPanel: null,
      aiEnabledInput: null,
      aiApiKeyInput: null,
      aiSettingsSaveButton: null,
      downloadButton: null,
      openButton: null,
      fileInput: null,
      connectGoogleButton: {hidden: false} as HTMLElement,
      openDriveButton: {hidden: false} as HTMLElement,
      saveDriveButton,
      disconnectGoogleButton: {hidden: false} as HTMLElement,
      createRoomButton: null,
      joinRoomButton: null,
      copyInviteButton: null,
      collabInviteInput: null,
    });
    expect(saveDriveButton.hidden).toBe(false);
  });
});
