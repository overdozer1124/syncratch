/**
 * Browser-local AI settings. Stored in localStorage only — never in
 * ProjectDocument, Y.Doc, .sb3, Drive payloads, or collab signaling.
 */

import {
  clampAiLevel,
  DEFAULT_AI_LEVEL,
  type AiAssistLevel,
} from "./levels.js";
import {
  detectProviderFromApiKey,
  normalizeApiKey,
  parseAiProviderId,
  preferCheapModel,
  providerLabel,
  supportedKeyExamples,
  type AiProviderId,
} from "./providers.js";

export const AI_SETTINGS_STORAGE_KEY = "blocksync.ai-assist.settings.v1";

export interface AiAssistSettings {
  /** Master switch. Default false (AI off). */
  enabled: boolean;
  /** Provider API key entered by the user (local only). */
  apiKey: string;
  /** Configured utilization level (0–6). Meaningful only when enabled. */
  level: AiAssistLevel;
  /**
   * Optional explicit model override. Empty → cheap default for detected provider.
   */
  modelOverride: string;
  /**
   * Optional provider override when auto-detect fails or user wants to force one.
   * Empty → use auto-detect from the API key.
   */
  providerOverride: "" | Exclude<AiProviderId, "unknown">;
}

export const DEFAULT_AI_SETTINGS: AiAssistSettings = {
  enabled: false,
  apiKey: "",
  level: DEFAULT_AI_LEVEL,
  modelOverride: "",
  providerOverride: "",
};

export interface AiAssistResolvedConfig {
  settings: AiAssistSettings;
  provider: AiProviderId;
  providerLabel: string;
  providerConfident: boolean;
  /** True when provider came from providerOverride rather than key shape. */
  providerForced: boolean;
  model: string | null;
  modelReason: string | null;
  ready: boolean;
  /** Why not ready, when ready is false. */
  notReadyReason: string | null;
}

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function normalizeProviderOverride(
  value: unknown,
): "" | Exclude<AiProviderId, "unknown"> {
  if (value === "" || value == null) return "";
  const parsed = parseAiProviderId(value);
  if (!parsed || parsed === "unknown") return "";
  return parsed;
}

export function normalizeAiAssistSettings(
  input: Partial<AiAssistSettings> | null | undefined,
): AiAssistSettings {
  return {
    enabled: Boolean(input?.enabled),
    apiKey:
      typeof input?.apiKey === "string" ? normalizeApiKey(input.apiKey) : "",
    level: clampAiLevel(input?.level ?? DEFAULT_AI_LEVEL),
    modelOverride:
      typeof input?.modelOverride === "string"
        ? input.modelOverride.trim()
        : "",
    providerOverride: normalizeProviderOverride(input?.providerOverride),
  };
}

export function loadAiAssistSettings(
  storage: StorageLike | null | undefined,
): AiAssistSettings {
  if (!storage) return {...DEFAULT_AI_SETTINGS};
  try {
    const raw = storage.getItem(AI_SETTINGS_STORAGE_KEY);
    if (!raw) return {...DEFAULT_AI_SETTINGS};
    const parsed = JSON.parse(raw) as Partial<AiAssistSettings>;
    return normalizeAiAssistSettings(parsed);
  } catch {
    return {...DEFAULT_AI_SETTINGS};
  }
}

export function saveAiAssistSettings(
  storage: StorageLike | null | undefined,
  settings: Partial<AiAssistSettings>,
): AiAssistSettings {
  const normalized = normalizeAiAssistSettings(settings);
  if (!storage) return normalized;
  try {
    storage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Quota / private mode — keep in-memory only.
  }
  return normalized;
}

export function clearAiAssistSettings(
  storage: StorageLike | null | undefined,
): void {
  if (!storage) return;
  try {
    storage.removeItem(AI_SETTINGS_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function resolveAiAssistConfig(
  settingsInput: Partial<AiAssistSettings>,
): AiAssistResolvedConfig {
  const settings = normalizeAiAssistSettings(settingsInput);
  const detect = detectProviderFromApiKey(settings.apiKey);
  const providerForced = Boolean(settings.providerOverride);
  const provider = settings.providerOverride || detect.provider;
  const cheap = preferCheapModel(provider);
  const model =
    settings.modelOverride ||
    cheap?.model ||
    null;
  const modelReason = settings.modelOverride
    ? "手動で指定したモデル"
    : (cheap?.reason ?? null);
  const label = providerForced
    ? `${providerLabel(provider)}（手動）`
    : detect.label;

  if (!settings.enabled) {
    return {
      settings,
      provider,
      providerLabel: label,
      providerConfident: detect.confident || providerForced,
      providerForced,
      model,
      modelReason,
      ready: false,
      notReadyReason: "AI はオフです。設定からオンにできます。",
    };
  }
  if (!settings.apiKey) {
    return {
      settings,
      provider,
      providerLabel: label,
      providerConfident: detect.confident || providerForced,
      providerForced,
      model,
      modelReason,
      ready: false,
      notReadyReason: "API キーを設定してください。",
    };
  }
  if (provider === "unknown" || !model) {
    return {
      settings,
      provider,
      providerLabel: label,
      providerConfident: false,
      providerForced,
      model,
      modelReason,
      ready: false,
      notReadyReason:
        `API キーから AI を判別できませんでした。設定の「AI の種類」で手動選択するか、対応キー（${supportedKeyExamples()}）を入れてください。`,
    };
  }
  if (settings.level === 0) {
    return {
      settings,
      provider,
      providerLabel: label,
      providerConfident: detect.confident || providerForced,
      providerForced,
      model,
      modelReason,
      ready: false,
      notReadyReason: "利用レベルがオフです。",
    };
  }

  return {
    settings,
    provider,
    providerLabel: label,
    providerConfident: detect.confident || providerForced,
    providerForced,
    model,
    modelReason,
    ready: true,
    notReadyReason: null,
  };
}

/** Mask a key for display: keep prefix + last 4 chars. */
export function maskApiKey(apiKey: string): string {
  const key = normalizeApiKey(apiKey);
  if (!key) return "";
  if (key.length <= 8) return "••••";
  return `${key.slice(0, 6)}…${key.slice(-4)}`;
}
