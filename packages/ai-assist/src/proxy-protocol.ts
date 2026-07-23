/**
 * Wire protocol for same-origin AI chat proxy (collab-host).
 * The proxy never stores API keys; it forwards Authorization and drops the body key.
 */

import type {AiProviderId} from "./providers.js";
import type {AiChatMessage} from "./prompt.js";

export const AI_CHAT_PROXY_PATH = "/ai/chat";

export interface AiChatProxyRequest {
  provider: AiProviderId;
  model: string;
  messages: AiChatMessage[];
  /** Soft cap; proxy clamps further. */
  maxTokens?: number;
  temperature?: number;
}

export interface AiChatProxySuccess {
  ok: true;
  provider: AiProviderId;
  model: string;
  content: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

export interface AiChatProxyFailure {
  ok: false;
  code:
    | "BAD_REQUEST"
    | "UNAUTHORIZED"
    | "PROVIDER_ERROR"
    | "UNSUPPORTED_PROVIDER"
    | "RATE_LIMITED"
    | "UPSTREAM_TIMEOUT"
    | "INTERNAL";
  message: string;
  status?: number;
}

export type AiChatProxyResponse = AiChatProxySuccess | AiChatProxyFailure;

export const AI_CHAT_MAX_MESSAGES = 12;
export const AI_CHAT_MAX_MESSAGE_CHARS = 8000;
export const AI_CHAT_DEFAULT_MAX_TOKENS = 512;
export const AI_CHAT_HARD_MAX_TOKENS = 1024;
