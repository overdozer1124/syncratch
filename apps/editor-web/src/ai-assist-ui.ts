/**
 * Editor-local AI assist UI helpers.
 * Keep collab / Drive / save paths untouched — only reads VM JSON when asked.
 */

import {
  AI_QUESTION_TARGET_ALL,
  allAiLevelPolicies,
  aiLevelPolicy,
  buildClarifyGenerationMessages,
  buildClarifyPrompt,
  buildFallbackClarifyPrompt,
  buildOtherClarifyChoice,
  effectiveAiLevel,
  formatClarifiedIntentLabel,
  formatQuestionTargetLabel,
  KNOWN_AI_PROVIDERS,
  listAiQuestionTargets,
  needsIntentClarification,
  parseClarifyResponse,
  providerLabel,
  resolveAiAssistConfig,
  resolveQuestionTargetName,
  type AiAdviceMode,
  type AiAssistLevel,
  type AiAssistResolvedConfig,
  type AiAssistSettings,
  type AiClarifyChoice,
  type AiClarifyPrompt,
  type AiConversationTurn,
  type AiProviderId,
  type ScratchProjectJsonLike,
} from "@blocksync/ai-assist";

export {
  AI_QUESTION_TARGET_ALL,
  buildClarifyGenerationMessages,
  buildClarifyPrompt,
  buildFallbackClarifyPrompt,
  buildOtherClarifyChoice,
  formatClarifiedIntentLabel,
  formatQuestionTargetLabel,
  needsIntentClarification,
  parseClarifyResponse,
};
export type {AiClarifyChoice, AiClarifyPrompt};

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

export function aiQuestionTargetOptions(
  projectJson: ScratchProjectJsonLike | null | undefined,
): Array<{value: string; label: string}> {
  return listAiQuestionTargets(projectJson).map(option => ({
    value: option.value,
    label: option.label,
  }));
}

/**
 * Prefer keeping the current selection; otherwise the editing sprite;
 * otherwise whole project.
 */
export function pickAiQuestionTargetValue(params: {
  previousValue: string;
  availableValues: string[];
  editingTargetName: string | null;
}): string {
  const {previousValue, availableValues, editingTargetName} = params;
  if (previousValue && availableValues.includes(previousValue)) {
    return previousValue;
  }
  if (editingTargetName && availableValues.includes(editingTargetName)) {
    return editingTargetName;
  }
  return availableValues.includes(AI_QUESTION_TARGET_ALL)
    ? AI_QUESTION_TARGET_ALL
    : (availableValues[0] ?? AI_QUESTION_TARGET_ALL);
}

export function aiQuestionTargetHint(selectedValue: string): string {
  const target = resolveQuestionTargetName(selectedValue);
  if (!target) {
    return "いまは作品全体について質問します。AI にも「作品全体」と伝わります。";
  }
  return `いまは ${formatQuestionTargetLabel(target)} について質問します。AI にも同じ対象が伝わります。`;
}

/** Split a flat turn list into visible Q&A pages (user+assistant pairs). */
export function listAiConversationPages(
  conversation: AiConversationTurn[],
): Array<[AiConversationTurn, AiConversationTurn]> {
  const pages: Array<[AiConversationTurn, AiConversationTurn]> = [];
  for (let i = 0; i + 1 < conversation.length; i += 2) {
    const userTurn = conversation[i];
    const assistantTurn = conversation[i + 1];
    if (userTurn?.role === "user" && assistantTurn?.role === "assistant") {
      pages.push([userTurn, assistantTurn]);
    }
  }
  return pages;
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
  if (/API key|Unauthorized|401|403/i.test(message)) {
    return "API キーが正しくないか、使う権限がありません。設定を確認してください。";
  }
  if (/model unavailable|not found|no longer available|deprecated|shutdown|404/i.test(message)) {
    return "このモデルは使えません。設定の「モデル指定」を空にするか、別のモデル名にしてください。";
  }
  if (/overloaded|UNAVAILABLE|503/i.test(message)) {
    return "AI 側が混み合っています。少し待ってからもう一度ためしてください。";
  }
  if (/RESOURCE_EXHAUSTED|quota/i.test(message)) {
    return "利用回数や枠をこえたようです。しばらく待つか、Google AI Studio の利用状況を確認してください。";
  }
  if (/rate limit|429/i.test(message)) {
    return "いま混み合っているか、回数制限です。少し待ってからもう一度ためしてください。";
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
