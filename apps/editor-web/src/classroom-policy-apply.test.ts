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
});
