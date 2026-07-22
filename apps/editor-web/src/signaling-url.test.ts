import {describe, expect, it} from "vitest";
import {
  resolveCollabSignalingUrl,
  SAME_ORIGIN_SIGNALING,
} from "./signaling-url.js";

describe("resolveCollabSignalingUrl", () => {
  it("returns empty when unset so collaboration stays disabled", () => {
    expect(resolveCollabSignalingUrl(undefined)).toBe("");
    expect(resolveCollabSignalingUrl("")).toBe("");
    expect(resolveCollabSignalingUrl("   ")).toBe("");
  });

  it("passes through explicit ws/wss URLs", () => {
    expect(resolveCollabSignalingUrl("wss://signal.example/signal")).toBe(
      "wss://signal.example/signal",
    );
    expect(resolveCollabSignalingUrl(" ws://127.0.0.1:4455 ")).toBe(
      "ws://127.0.0.1:4455",
    );
  });

  it("resolves same-origin to wss on https pages", () => {
    expect(
      resolveCollabSignalingUrl(SAME_ORIGIN_SIGNALING, {
        protocol: "https:",
        host: "syncratch.up.railway.app",
      }),
    ).toBe("wss://syncratch.up.railway.app/signal");
  });

  it("resolves same-origin to ws on http pages", () => {
    expect(
      resolveCollabSignalingUrl(SAME_ORIGIN_SIGNALING, {
        protocol: "http:",
        host: "127.0.0.1:8080",
      }),
    ).toBe("ws://127.0.0.1:8080/signal");
  });

  it("returns empty for same-origin when location is unavailable", () => {
    expect(resolveCollabSignalingUrl(SAME_ORIGIN_SIGNALING, null)).toBe("");
  });
});
