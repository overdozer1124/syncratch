/**
 * Server-side upstream forwarder used by collab-host `/ai/chat`.
 * Kept in ai-assist so host stays a thin adapter (no collab logic changes).
 */

import {
  AI_CHAT_DEFAULT_MAX_TOKENS,
  AI_CHAT_HARD_MAX_TOKENS,
  AI_CHAT_MAX_MESSAGE_CHARS,
  AI_CHAT_MAX_MESSAGES,
  type AiChatProxyRequest,
  type AiChatProxyResponse,
} from "./proxy-protocol.js";
import {
  isOpenAiCompatible,
  providerEndpoint,
  type AiProviderId,
} from "./providers.js";
import type {AiChatMessage} from "./prompt.js";

export interface ForwardAiChatOptions {
  apiKey: string;
  request: AiChatProxyRequest;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

function clampMaxTokens(value: number | undefined): number {
  const n = typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : AI_CHAT_DEFAULT_MAX_TOKENS;
  return Math.min(AI_CHAT_HARD_MAX_TOKENS, Math.max(16, n));
}

function validateMessages(
  messages: unknown,
): {ok: true; messages: AiChatMessage[]} | {ok: false; message: string} {
  if (!Array.isArray(messages) || messages.length === 0) {
    return {ok: false, message: "messages must be a non-empty array"};
  }
  if (messages.length > AI_CHAT_MAX_MESSAGES) {
    return {ok: false, message: "too many messages"};
  }
  const out: AiChatMessage[] = [];
  for (const item of messages) {
    if (!item || typeof item !== "object") {
      return {ok: false, message: "invalid message"};
    }
    const role = (item as {role?: unknown}).role;
    const content = (item as {content?: unknown}).content;
    if (
      role !== "system" &&
      role !== "user" &&
      role !== "assistant"
    ) {
      return {ok: false, message: "invalid message role"};
    }
    if (typeof content !== "string" || !content.trim()) {
      return {ok: false, message: "invalid message content"};
    }
    if (content.length > AI_CHAT_MAX_MESSAGE_CHARS) {
      return {ok: false, message: "message too long"};
    }
    out.push({role, content});
  }
  return {ok: true, messages: out};
}

export function parseAiChatProxyBody(
  body: unknown,
): {ok: true; request: AiChatProxyRequest} | {ok: false; message: string} {
  if (!body || typeof body !== "object") {
    return {ok: false, message: "JSON body required"};
  }
  const provider = (body as {provider?: unknown}).provider;
  const model = (body as {model?: unknown}).model;
  if (typeof provider !== "string" || !provider) {
    return {ok: false, message: "provider required"};
  }
  if (typeof model !== "string" || !model.trim()) {
    return {ok: false, message: "model required"};
  }
  const messagesResult = validateMessages((body as {messages?: unknown}).messages);
  if (!messagesResult.ok) return messagesResult;

  const maxTokens = (body as {maxTokens?: unknown}).maxTokens;
  const temperature = (body as {temperature?: unknown}).temperature;

  return {
    ok: true,
    request: {
      provider: provider as AiProviderId,
      model: model.trim(),
      messages: messagesResult.messages,
      maxTokens:
        typeof maxTokens === "number" ? clampMaxTokens(maxTokens) : undefined,
      temperature:
        typeof temperature === "number" && Number.isFinite(temperature)
          ? temperature
          : undefined,
    },
  };
}

export function extractBearerToken(
  authorization: string | string[] | undefined,
): string | null {
  const value = Array.isArray(authorization)
    ? authorization[0]
    : authorization;
  if (!value) return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1]?.trim() || null;
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

function failure(
  code: Extract<AiChatProxyResponse, {ok: false}>["code"],
  message: string,
  status?: number,
): AiChatProxyResponse {
  return {ok: false, code, message, status};
}

export async function forwardAiChat(
  options: ForwardAiChatOptions,
): Promise<AiChatProxyResponse> {
  const {apiKey, request} = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const maxTokens = clampMaxTokens(request.maxTokens);
  const temperature = request.temperature ?? 0.3;
  const provider = request.provider;

  if (provider === "unknown") {
    return failure("UNSUPPORTED_PROVIDER", "unsupported provider");
  }

  try {
    if (provider === "anthropic") {
      const endpoint = providerEndpoint("anthropic");
      if (!endpoint) return failure("INTERNAL", "missing endpoint");
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
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: request.model,
          max_tokens: maxTokens,
          temperature,
          system: system || undefined,
          messages,
        }),
        signal: options.signal,
      });
      const body = await readJson(response);
      if (response.status === 401 || response.status === 403) {
        return failure("UNAUTHORIZED", "API key rejected", response.status);
      }
      if (response.status === 429) {
        return failure("RATE_LIMITED", "provider rate limited", 429);
      }
      if (!response.ok) {
        return failure(
          "PROVIDER_ERROR",
          `anthropic ${response.status}`,
          response.status,
        );
      }
      const blocks = (body as {content?: Array<{type?: string; text?: string}>})
        ?.content;
      const content = Array.isArray(blocks)
        ? blocks
            .filter(b => b?.type === "text" && typeof b.text === "string")
            .map(b => b.text as string)
            .join("\n")
            .trim()
        : "";
      if (!content) {
        return failure("PROVIDER_ERROR", "empty anthropic content");
      }
      return {
        ok: true,
        provider,
        model: request.model,
        content,
        usage: {
          inputTokens: (body as {usage?: {input_tokens?: number}})?.usage
            ?.input_tokens,
          outputTokens: (body as {usage?: {output_tokens?: number}})?.usage
            ?.output_tokens,
        },
      };
    }

    if (provider === "gemini") {
      const base = providerEndpoint("gemini");
      if (!base) return failure("INTERNAL", "missing endpoint");
      const url =
        `${base}/models/${encodeURIComponent(request.model)}:generateContent` +
        `?key=${encodeURIComponent(apiKey)}`;
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
        signal: options.signal,
      });
      const body = await readJson(response);
      if (response.status === 401 || response.status === 403) {
        return failure("UNAUTHORIZED", "API key rejected", response.status);
      }
      if (response.status === 429) {
        return failure("RATE_LIMITED", "provider rate limited", 429);
      }
      if (!response.ok) {
        return failure(
          "PROVIDER_ERROR",
          `gemini ${response.status}`,
          response.status,
        );
      }
      const parts = (
        body as {
          candidates?: Array<{content?: {parts?: Array<{text?: string}>}}>;
        }
      )?.candidates?.[0]?.content?.parts;
      const content = Array.isArray(parts)
        ? parts.map(p => (typeof p.text === "string" ? p.text : "")).join("").trim()
        : "";
      if (!content) {
        return failure("PROVIDER_ERROR", "empty gemini content");
      }
      return {
        ok: true,
        provider,
        model: request.model,
        content,
        usage: {
          inputTokens: (body as {usageMetadata?: {promptTokenCount?: number}})
            ?.usageMetadata?.promptTokenCount,
          outputTokens: (
            body as {usageMetadata?: {candidatesTokenCount?: number}}
          )?.usageMetadata?.candidatesTokenCount,
        },
      };
    }

    if (!isOpenAiCompatible(provider)) {
      return failure("UNSUPPORTED_PROVIDER", `unsupported provider: ${provider}`);
    }

    const endpoint = providerEndpoint(provider);
    if (!endpoint) return failure("INTERNAL", "missing endpoint");

    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    };
    if (provider === "openrouter") {
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
      signal: options.signal,
    });
    const body = await readJson(response);
    if (response.status === 401 || response.status === 403) {
      return failure("UNAUTHORIZED", "API key rejected", response.status);
    }
    if (response.status === 429) {
      return failure("RATE_LIMITED", "provider rate limited", 429);
    }
    if (!response.ok) {
      return failure(
        "PROVIDER_ERROR",
        `${provider} ${response.status}`,
        response.status,
      );
    }
    const content = (
      body as {choices?: Array<{message?: {content?: string}}>}
    )?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return failure("PROVIDER_ERROR", "empty content");
    }
    const usage = (body as {
      usage?: {prompt_tokens?: number; completion_tokens?: number};
    })?.usage;
    return {
      ok: true,
      provider,
      model: request.model,
      content: content.trim(),
      usage: {
        inputTokens: usage?.prompt_tokens,
        outputTokens: usage?.completion_tokens,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "upstream failure";
    if (/abort|timeout/i.test(message)) {
      return failure("UPSTREAM_TIMEOUT", message);
    }
    return failure("PROVIDER_ERROR", message);
  }
}
