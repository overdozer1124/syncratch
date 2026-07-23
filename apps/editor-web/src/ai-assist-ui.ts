/**
 * Editor-local AI assist UI helpers.
 * Keep collab / Drive / save paths untouched — only reads VM JSON when asked.
 */

import {
  allAiLevelPolicies,
  aiLevelPolicy,
  effectiveAiLevel,
  KNOWN_AI_PROVIDERS,
  providerLabel,
  resolveAiAssistConfig,
  type AiAdviceMode,
  type AiAssistLevel,
  type AiAssistResolvedConfig,
  type AiAssistSettings,
  type AiProviderId,
} from "@blocksync/ai-assist";

export function aiPanelHidden(settings: AiAssistSettings): boolean {
  const level = effectiveAiLevel(settings.enabled, settings.level);
  return !aiLevelPolicy(level).visible;
}

export function aiStatusSummary(config: AiAssistResolvedConfig): string {
  if (!config.settings.enabled) return "AI はオフ";
  if (!config.settings.apiKey) return "API キー未設定";
  if (!config.ready) return config.notReadyReason ?? "じゅんび中";
  return `${config.providerLabel} / ${config.model ?? "?"}`;
}

export function aiModeOptionsForLevel(
  level: AiAssistLevel,
): Array<{value: AiAdviceMode; label: string}> {
  const policy = aiLevelPolicy(level);
  if (!policy.canChat) return [];
  const options: Array<{value: AiAdviceMode; label: string}> = [
    {value: "explain", label: "説明してもらう"},
    {value: "hint", label: "ヒントがほしい"},
  ];
  if (level >= 2) {
    options.push({value: "debug", label: "デバッグの助言"});
  }
  return options;
}

export function levelSelectOptions(): Array<{
  value: AiAssistLevel;
  label: string;
}> {
  return allAiLevelPolicies().map(policy => ({
    value: policy.level,
    label: `${policy.level}: ${policy.label}`,
  }));
}

export function providerSelectOptions(): Array<{
  value: "" | Exclude<AiProviderId, "unknown">;
  label: string;
}> {
  return [
    {value: "", label: "自動判別（キーの形から）"},
    ...KNOWN_AI_PROVIDERS.map(id => ({
      value: id,
      label: providerLabel(id),
    })),
  ];
}

export function readSettingsFromForm(input: {
  enabled: boolean;
  apiKey: string;
  level: string | number;
  modelOverride: string;
  providerOverride?: string;
}): AiAssistSettings {
  return resolveAiAssistConfig({
    enabled: input.enabled,
    apiKey: input.apiKey,
    level: Number(input.level) as AiAssistLevel,
    modelOverride: input.modelOverride,
    providerOverride: (input.providerOverride ?? "") as AiAssistSettings["providerOverride"],
  }).settings;
}

export function friendlyAiError(message?: string): string {
  if (!message) return "AI でエラーが起きました。もう一度ためしてください。";
  if (/API key|Unauthorized|401/i.test(message)) {
    return "API キーが正しくないようです。設定を確認してください。";
  }
  if (/rate limit|429/i.test(message)) {
    return "いま混み合っています。少し待ってからもう一度ためしてください。";
  }
  if (/判別|unsupported provider|unknown/i.test(message)) {
    return "AI を判別できませんでした。設定の「AI の種類」で手動選択してください。";
  }
  if (/empty|question/i.test(message)) {
    return "質問を書いてから送ってください。";
  }
  if (/オフ|disabled|not ready/i.test(message)) {
    return "AI がオフか、まだ準備ができていません。設定を確認してください。";
  }
  return "AI でエラーが起きました。もう一度ためしてください。";
}
