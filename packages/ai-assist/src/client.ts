/**
 * Browser / Node chat client.
 * Prefers same-origin proxy (CORS-safe). Direct provider calls are available for tests.
 */

import {
  AI_CHAT_DEFAULT_MAX_TOKENS,
  AI_CHAT_HARD_MAX_TOKENS,
  AI_CHAT_PROXY_PATH,
  type AiChatProxyRequest,
  type AiChatProxyResponse,
} from "./proxy-protocol.js";
import {
  isOpenAiCompatible,
  providerEndpoint,
  type AiProviderId,
} from "./providers.js";
import type {AiChatMessage} from "./prompt.js";

export interface AiChatRequest {
  provider: AiProviderId;
  model: string;
  apiKey: string;
  messages: AiChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /**
   * Absolute or path URL for the proxy. Default: same-origin `/ai/chat`.
   * Pass `null` to force direct provider HTTP (Node / tests).
   */
  proxyUrl?: string | null;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

export interface AiChatResult {
  provider: AiProviderId;
  model: string;
  content: string;
  via: "proxy" | "direct";
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

function clampMaxTokens(value: number | undefined): number {
  const n = typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : AI_CHAT_DEFAULT_MAX_TOKENS;
  return Math.min(AI_CHAT_HARD_MAX_TOKENS, Math.max(16, n));
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {raw: text};
  }
}

function contentFromOpenAiCompatible(body: unknown): string {
  const choices = (body as {choices?: Array<{message?: {content?: string}}>})
    ?.choices;
  const content = choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  throw new Error("provider returned empty content");
}

function contentFromAnthropic(body: unknown): string {
  const blocks = (body as {content?: Array<{type?: string; text?: string}>})
    ?.content;
  if (!Array.isArray(blocks)) {
    throw new Error("anthropic returned unexpected body");
  }
  const text = blocks
    .filter(block => block?.type === "text" && typeof block.text === "string")
    .map(block => block.text as string)
    .join("\n")
    .trim();
  if (!text) throw new Error("anthropic returned empty content");
  return text;
}

function contentFromGemini(body: unknown): string {
  const candidates = (
    body as {
      candidates?: Array<{
        content?: {parts?: Array<{text?: string}>};
      }>;
    }
  )?.candidates;
  const parts = candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    throw new Error("gemini returned unexpected body");
  }
  const text = parts
    .map(part => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();
  if (!text) throw new Error("gemini returned empty content");
  return text;
}

export async function chatViaProxy(
  request: AiChatRequest,
): Promise<AiChatResult> {
  const fetchImpl = request.fetchImpl ?? fetch;
  const url = request.proxyUrl ?? AI_CHAT_PROXY_PATH;
  const body: AiChatProxyRequest = {
    provider: request.provider,
    model: request.model,
    messages: request.messages,
    maxTokens: clampMaxTokens(request.maxTokens),
    temperature: request.temperature ?? 0.3,
  };

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${request.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: request.signal,
  });

  const parsed = (await readJson(response)) as AiChatProxyResponse | null;
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`AI proxy error (${response.status})`);
  }
  if (!("ok" in parsed) || !parsed.ok) {
    const failure = parsed as {message?: string; code?: string};
    throw new Error(
      failure.message ??
        `AI proxy failed (${failure.code ?? response.status})`,
    );
  }
  return {
    provider: parsed.provider,
    model: parsed.model,
    content: parsed.content,
    via: "proxy",
    usage: parsed.usage,
  };
}

export async function chatDirect(
  request: AiChatRequest,
): Promise<AiChatResult> {
  const fetchImpl = request.fetchImpl ?? fetch;
  const maxTokens = clampMaxTokens(request.maxTokens);
  const temperature = request.temperature ?? 0.3;

  if (request.provider === "unknown") {
    throw new Error("unsupported provider");
  }

  if (request.provider === "anthropic") {
    const endpoint = providerEndpoint("anthropic");
    if (!endpoint) throw new Error("missing anthropic endpoint");
    const system = request.messages
      .filter(m => m.role === "system")
      .map(m => m.content)
      .join("\n");
    const messages = request.messages
      .filter(m => m.role !== "system")
      .map(m => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: m.content,
      }));
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": request.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: request.model,
        max_tokens: maxTokens,
        temperature,
        system: system || undefined,
        messages,
      }),
      signal: request.signal,
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new Error(
        `anthropic error ${response.status}: ${JSON.stringify(body)}`,
      );
    }
    return {
      provider: request.provider,
      model: request.model,
      content: contentFromAnthropic(body),
      via: "direct",
    };
  }

  if (request.provider === "gemini") {
    const base = providerEndpoint("gemini");
    if (!base) throw new Error("missing gemini endpoint");
    const url =
      `${base}/models/${encodeURIComponent(request.model)}:generateContent` +
      `?key=${encodeURIComponent(request.apiKey)}`;
    const system = request.messages
      .filter(m => m.role === "system")
      .map(m => m.content)
      .join("\n");
    const contents = request.messages
      .filter(m => m.role !== "system")
      .map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{text: m.content}],
      }));
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: JSON.stringify({
        systemInstruction: system
          ? {parts: [{text: system}]}
          : undefined,
        contents,
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature,
        },
      }),
      signal: request.signal,
    });
    const body = await readJson(response);
    if (!response.ok) {
      throw new Error(
        `gemini error ${response.status}: ${JSON.stringify(body)}`,
      );
    }
    return {
      provider: request.provider,
      model: request.model,
      content: contentFromGemini(body),
      via: "direct",
      usage: {
        inputTokens: (body as {usageMetadata?: {promptTokenCount?: number}})
          ?.usageMetadata?.promptTokenCount,
        outputTokens: (
          body as {usageMetadata?: {candidatesTokenCount?: number}}
        )?.usageMetadata?.candidatesTokenCount,
      },
    };
  }

  if (!isOpenAiCompatible(request.provider)) {
    throw new Error(`unsupported provider: ${request.provider}`);
  }

  const endpoint = providerEndpoint(request.provider);
  if (!endpoint) throw new Error("missing endpoint");

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${request.apiKey}`,
  };
  if (request.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://syncratch.local";
    headers["X-Title"] = "Syncratch AI Assist";
  }

  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: request.model,
      messages: request.messages,
      max_tokens: maxTokens,
      temperature,
    }),
    signal: request.signal,
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      `${request.provider} error ${response.status}: ${JSON.stringify(body)}`,
    );
  }
  const usage = (body as {
    usage?: {prompt_tokens?: number; completion_tokens?: number};
  })?.usage;
  return {
    provider: request.provider,
    model: request.model,
    content: contentFromOpenAiCompatible(body),
    via: "direct",
    usage: {
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens,
    },
  };
}

/**
 * Default browser path: proxy. Pass `proxyUrl: null` for direct.
 */
export async function requestAiChat(
  request: AiChatRequest,
): Promise<AiChatResult> {
  if (request.proxyUrl === null) {
    return chatDirect(request);
  }
  return chatViaProxy(request);
}
