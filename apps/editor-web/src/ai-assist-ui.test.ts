import {describe, expect, it} from "vitest";
import {
  aiModeOptionsForLevel,
  aiPanelHidden,
  aiStatusSummary,
  friendlyAiError,
  providerSelectOptions,
  readSettingsFromForm,
} from "./ai-assist-ui.js";
import {resolveAiAssistConfig} from "@blocksync/ai-assist";

describe("ai-assist-ui", () => {
  it("hides panel when disabled (default)", () => {
    expect(
      aiPanelHidden({
        enabled: false,
        apiKey: "",
        level: 2,
        modelOverride: "",
        providerOverride: "",
      }),
    ).toBe(true);
    expect(
      aiPanelHidden({
        enabled: true,
        apiKey: "sk-x",
        level: 2,
        modelOverride: "",
        providerOverride: "",
      }),
    ).toBe(false);
  });

  it("summarizes status and modes", () => {
    const off = resolveAiAssistConfig({
      enabled: false,
      apiKey: "",
      level: 2,
      modelOverride: "",
      providerOverride: "",
    });
    expect(aiStatusSummary(off)).toBe("AI はオフ");
    expect(aiModeOptionsForLevel(1).map(o => o.value)).toEqual([
      "explain",
      "hint",
    ]);
    expect(aiModeOptionsForLevel(2).some(o => o.value === "debug")).toBe(true);
    expect(providerSelectOptions()[0]?.value).toBe("");
  });

  it("reads form settings with default-off semantics", () => {
    const settings = readSettingsFromForm({
      enabled: false,
      apiKey: ' "sk-test" ',
      level: "3",
      modelOverride: "",
      providerOverride: "gemini",
    });
    expect(settings.enabled).toBe(false);
    expect(settings.apiKey).toBe("sk-test");
    expect(settings.level).toBe(3);
    expect(settings.providerOverride).toBe("gemini");
  });

  it("maps friendly errors", () => {
    expect(friendlyAiError("401 Unauthorized")).toContain("API キー");
    expect(friendlyAiError("rate limit 429")).toContain("混み合って");
    expect(friendlyAiError("判別できません")).toContain("手動選択");
  });
});
