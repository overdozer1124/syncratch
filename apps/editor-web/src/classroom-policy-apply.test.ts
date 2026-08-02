import {describe, expect, it} from "vitest";
import type {StudentPolicyView} from "@blocksync/classroom-access";
import {
  aiSettingsFromStudentPolicy,
  applyStudentPolicyToDom,
  shouldHideStudentDriveControls,
  studentPolicyBlocksAiPersist,
} from "./classroom-policy-apply.js";
import {
  CLASSROOM_DRIVE_BLOCKED_HELP,
  CLASSROOM_DRIVE_BLOCKED_STATUS,
} from "./ui-copy.js";

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

  it("hides Drive CTAs only when both drive and collab are disallowed", () => {
    expect(shouldHideStudentDriveControls(policy({drive: {allow: false}}))).toBe(
      false,
    );
    expect(
      shouldHideStudentDriveControls(
        policy({drive: {allow: false}, collab: {allow: false}}),
      ),
    ).toBe(true);
    expect(shouldHideStudentDriveControls(policy({drive: {allow: true}}))).toBe(
      false,
    );
  });

  it("shows policy-blocked messaging when Drive and collab are both off", () => {
    const connectGoogleButton = {hidden: false} as HTMLElement;
    const openDriveButton = {hidden: false} as HTMLElement;
    const saveDriveButton = {hidden: false} as HTMLElement;
    const disconnectGoogleButton = {hidden: false} as HTMLElement;
    const driveStatus = {textContent: "", title: ""} as HTMLElement;
    const driveSectionHelp = {textContent: "old"} as HTMLElement;
    const driveControls = {hidden: false} as HTMLElement;
    applyStudentPolicyToDom(
      policy({drive: {allow: false}, collab: {allow: false}}),
      {
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
        driveStatus,
        driveSectionHelp,
        driveControls,
      },
    );
    expect(connectGoogleButton.hidden).toBe(true);
    expect(openDriveButton.hidden).toBe(true);
    expect(saveDriveButton.hidden).toBe(true);
    expect(disconnectGoogleButton.hidden).toBe(true);
    expect(driveControls.hidden).toBe(true);
    expect(driveStatus.textContent).toBe(CLASSROOM_DRIVE_BLOCKED_STATUS);
    expect(driveSectionHelp.textContent).toBe(CLASSROOM_DRIVE_BLOCKED_HELP);
  });

  it("keeps Drive CTAs visible when collab is allowed even if drive.allow is false", () => {
    const saveDriveButton = {hidden: false} as HTMLElement;
    const connectGoogleButton = {hidden: false} as HTMLElement;
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
      openDriveButton: {hidden: false} as HTMLElement,
      saveDriveButton,
      disconnectGoogleButton: {hidden: false} as HTMLElement,
      createRoomButton: null,
      joinRoomButton: null,
      copyInviteButton: null,
      collabInviteInput: null,
    });
    expect(connectGoogleButton.hidden).toBe(false);
    expect(saveDriveButton.hidden).toBe(false);
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
