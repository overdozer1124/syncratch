/**
 * Detect AI provider from API key shape and map to cheap default models.
 * Order matters: more-specific prefixes before generic `sk-`.
 */

export type AiProviderId =
  | "anthropic"
  | "openai"
  | "gemini"
  | "groq"
  | "openrouter"
  | "deepseek"
  | "xai"
  | "unknown";

export const KNOWN_AI_PROVIDERS: ReadonlyArray<Exclude<AiProviderId, "unknown">> = [
  "openai",
  "anthropic",
  "gemini",
  "groq",
  "openrouter",
  "deepseek",
  "xai",
];

export interface ProviderDetectResult {
  provider: AiProviderId;
  /** Human-readable label for UI. */
  label: string;
  /** True when the key shape is recognized with high confidence. */
  confident: boolean;
  /** Key after quote / Bearer / whitespace normalization. */
  normalizedKey: string;
}

export interface ProviderModelChoice {
  provider: AiProviderId;
  /** Preferred low-cost chat model for advice/debug. */
  model: string;
  /** Short rationale for UI / logs. */
  reason: string;
}

interface PrefixRule {
  prefix: string;
  provider: AiProviderId;
  label: string;
  /** Match prefix case-insensitively when true. */
  ignoreCase?: boolean;
}

const PREFIX_RULES: readonly PrefixRule[] = [
  {prefix: "sk-ant-", provider: "anthropic", label: "Anthropic (Claude)"},
  {prefix: "sk-or-", provider: "openrouter", label: "OpenRouter"},
  {prefix: "gsk_", provider: "groq", label: "Groq"},
  {prefix: "AIza", provider: "gemini", label: "Google Gemini", ignoreCase: true},
  {prefix: "xai-", provider: "xai", label: "xAI", ignoreCase: true},
  {prefix: "sk-proj-", provider: "openai", label: "OpenAI"},
  {prefix: "sk-svcacct-", provider: "openai", label: "OpenAI"},
];

const PROVIDER_LABELS: Record<Exclude<AiProviderId, "unknown">, string> = {
  anthropic: "Anthropic (Claude)",
  openai: "OpenAI",
  gemini: "Google Gemini",
  groq: "Groq",
  openrouter: "OpenRouter",
  deepseek: "DeepSeek",
  xai: "xAI",
};

/** Cheap defaults: prefer small/fast models suitable for advice text. */
const CHEAP_MODELS: Record<Exclude<AiProviderId, "unknown">, ProviderModelChoice> = {
  anthropic: {
    provider: "anthropic",
    model: "claude-3-5-haiku-latest",
    reason: "Haiku 系は助言・説明向けにトークン単価が低い",
  },
  openai: {
    provider: "openai",
    model: "gpt-4o-mini",
    reason: "小型モデルで助言チャットのコスパが高い",
  },
  gemini: {
    provider: "gemini",
    model: "gemini-2.0-flash-lite",
    reason: "Flash-Lite は短文助言向けに費用が低い",
  },
  groq: {
    provider: "groq",
    model: "llama-3.1-8b-instant",
    reason: "小型 Llama で低レイテンシ・低コスト",
  },
  openrouter: {
    provider: "openrouter",
    model: "google/gemini-2.0-flash-lite-001",
    reason: "OpenRouter 経由の安価な Flash-Lite",
  },
  deepseek: {
    provider: "deepseek",
    model: "deepseek-chat",
    reason: "DeepSeek の標準チャットは単価が低い",
  },
  xai: {
    provider: "xai",
    model: "grok-2-mini",
    reason: "Mini 系を優先してトークン消費を抑える",
  },
};

/**
 * Normalize pasted keys: trim, strip wrapping quotes, drop accidental Bearer.
 */
export function normalizeApiKey(raw: string): string {
  let key = raw.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  key = key.replace(/^Bearer\s+/i, "").trim();
  // Remove zero-width / BOM characters that survive copy-paste.
  key = key.replace(/[\u200B-\u200D\uFEFF]/g, "");
  // Collapse accidental internal whitespace/newlines from multi-line pastes.
  if (/\s/.test(key)) {
    key = key.replace(/\s+/g, "");
  }
  return key;
}

export function providerLabel(provider: AiProviderId): string {
  if (provider === "unknown") return "不明（キー形式を確認してください）";
  return PROVIDER_LABELS[provider];
}

export function parseAiProviderId(value: unknown): AiProviderId | null {
  if (typeof value !== "string" || !value) return null;
  if (value === "unknown") return "unknown";
  if ((KNOWN_AI_PROVIDERS as readonly string[]).includes(value)) {
    return value as AiProviderId;
  }
  return null;
}

/**
 * Infer provider from a raw API key. Does not network-validate the key.
 */
export function detectProviderFromApiKey(apiKey: string): ProviderDetectResult {
  const key = normalizeApiKey(apiKey);
  if (!key) {
    return {
      provider: "unknown",
      label: "未設定",
      confident: false,
      normalizedKey: "",
    };
  }

  for (const rule of PREFIX_RULES) {
    const matches = rule.ignoreCase
      ? key.toLowerCase().startsWith(rule.prefix.toLowerCase())
      : key.startsWith(rule.prefix);
    if (matches) {
      return {
        provider: rule.provider,
        label: rule.label,
        confident: true,
        normalizedKey: key,
      };
    }
  }

  // DeepSeek often issues sk- + hex; prefer after OpenRouter/Anthropic checks.
  if (/^sk-[0-9a-f]{32,}$/i.test(key)) {
    return {
      provider: "deepseek",
      label: "DeepSeek",
      confident: false,
      normalizedKey: key,
    };
  }

  if (key.startsWith("sk-")) {
    return {
      provider: "openai",
      label: "OpenAI",
      confident: true,
      normalizedKey: key,
    };
  }

  // Long Google-style keys without AIza are uncommon; still hint Gemini weakly.
  if (/^[A-Za-z0-9_-]{35,45}$/.test(key) && key.includes("AIza")) {
    return {
      provider: "gemini",
      label: "Google Gemini",
      confident: false,
      normalizedKey: key,
    };
  }

  return {
    provider: "unknown",
    label: "不明（キー形式を確認するか、AI を手動選択してください）",
    confident: false,
    normalizedKey: key,
  };
}

/** Resolve the cost-preferred model for a provider. */
export function preferCheapModel(
  provider: AiProviderId,
): ProviderModelChoice | null {
  if (provider === "unknown") return null;
  return CHEAP_MODELS[provider];
}

export function resolveProviderAndModel(
  apiKey: string,
  providerOverride: AiProviderId | "" = "",
): {
  detect: ProviderDetectResult;
  provider: AiProviderId;
  model: ProviderModelChoice | null;
} {
  const detect = detectProviderFromApiKey(apiKey);
  const provider =
    providerOverride && providerOverride !== "unknown"
      ? providerOverride
      : detect.provider;
  return {
    detect,
    provider,
    model: preferCheapModel(provider),
  };
}

export function providerEndpoint(provider: AiProviderId): string | null {
  switch (provider) {
    case "openai":
      return "https://api.openai.com/v1/chat/completions";
    case "anthropic":
      return "https://api.anthropic.com/v1/messages";
    case "gemini":
      return "https://generativelanguage.googleapis.com/v1beta";
    case "groq":
      return "https://api.groq.com/openai/v1/chat/completions";
    case "openrouter":
      return "https://openrouter.ai/api/v1/chat/completions";
    case "deepseek":
      return "https://api.deepseek.com/chat/completions";
    case "xai":
      return "https://api.x.ai/v1/chat/completions";
    default:
      return null;
  }
}

export function isOpenAiCompatible(provider: AiProviderId): boolean {
  return (
    provider === "openai" ||
    provider === "groq" ||
    provider === "openrouter" ||
    provider === "deepseek" ||
    provider === "xai"
  );
}

export function supportedKeyExamples(): string {
  return [
    "OpenAI: sk-… / sk-proj-…",
    "Claude: sk-ant-…",
    "Gemini: AIza…",
    "Groq: gsk_…",
    "OpenRouter: sk-or-…",
  ].join(" / ");
}
