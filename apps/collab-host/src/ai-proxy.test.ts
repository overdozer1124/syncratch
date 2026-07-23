import {describe, expect, it} from "vitest";
import {AI_CHAT_PROXY_PATH} from "@blocksync/ai-assist";
import {isAiChatProxyPath} from "./ai-proxy.js";

describe("ai-proxy path", () => {
  it("matches /ai/chat only", () => {
    expect(AI_CHAT_PROXY_PATH).toBe("/ai/chat");
    expect(isAiChatProxyPath("/ai/chat")).toBe(true);
    expect(isAiChatProxyPath("/ai/chat?x=1")).toBe(true);
    expect(isAiChatProxyPath("/signal")).toBe(false);
    expect(isAiChatProxyPath("/")).toBe(false);
  });
});
