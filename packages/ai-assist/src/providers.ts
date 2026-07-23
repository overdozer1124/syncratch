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

export interface ProviderDetectResult {
  provider: AiProviderId;
  /** Human-readable label for UI. */
  label: string;
  /** True when the key shape is recognized with high confidence. */
  confident: boolean;
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
}

const PREFIX_RULES: readonly PrefixRule[] = [
  {prefix: "sk-ant-", provider: "anthropic", label: "Anthropic (Claude)"},
  {prefix: "sk-or-", provider: "openrouter", label: "OpenRouter"},
  {prefix: "gsk_", provider: "groq", label: "Groq"},
  {prefix: "AIza", provider: "gemini", label: "Google Gemini"},
  {prefix: "xai-", provider: "xai", label: "xAI"},
  {prefix: "sk-proj-", provider: "openai", label: "OpenAI"},
];

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
 * Infer provider from a raw API key. Does not network-validate the key.
 */
export function detectProviderFromApiKey(apiKey: string): ProviderDetectResult {
  const key = apiKey.trim();
  if (!key) {
    return {provider: "unknown", label: "未設定", confident: false};
  }

  for (const rule of PREFIX_RULES) {
    if (key.startsWith(rule.prefix)) {
      return {
        provider: rule.provider,
        label: rule.label,
        confident: true,
      };
    }
  }

  // DeepSeek often issues sk- + hex; prefer after OpenRouter/Anthropic checks.
  if (/^sk-[0-9a-f]{32,}$/i.test(key)) {
    return {
      provider: "deepseek",
      label: "DeepSeek",
      confident: false,
    };
  }

  if (key.startsWith("sk-")) {
    return {
      provider: "openai",
      label: "OpenAI",
      confident: true,
    };
  }

  return {
    provider: "unknown",
    label: "不明（キー形式を確認してください）",
    confident: false,
  };
}

/** Resolve the cost-preferred model for a provider. */
export function preferCheapModel(
  provider: AiProviderId,
): ProviderModelChoice | null {
  if (provider === "unknown") return null;
  return CHEAP_MODELS[provider];
}

export function resolveProviderAndModel(apiKey: string): {
  detect: ProviderDetectResult;
  model: ProviderModelChoice | null;
} {
  const detect = detectProviderFromApiKey(apiKey);
  return {
    detect,
    model: preferCheapModel(detect.provider),
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
