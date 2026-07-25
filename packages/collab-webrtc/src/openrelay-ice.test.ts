import {createHmac} from "node:crypto";
import {describe, expect, it} from "vitest";
import {
  OPENRELAY_STATIC_AUTH_HOST,
  OPENRELAY_STATIC_AUTH_SECRET,
  createOpenRelayIceServers,
  createStunOnlyIceServers,
} from "./openrelay-ice.js";

describe("createOpenRelayIceServers", () => {
  it("mints HMAC credentials for staticauth Open Relay URLs", async () => {
    const nowMs = 1_700_000_000_000;
    const ttlSec = 3600;
    const servers = await createOpenRelayIceServers({
      nowMs,
      ttlSec,
      userId: "guest",
      hmacSha1Base64: async (message, secret) =>
        createHmac("sha1", secret).update(message).digest("base64"),
    });

    expect(servers.some(s => JSON.stringify(s.urls).includes("stun.l.google.com"))).toBe(
      true,
    );
    const turn = servers.find(s =>
      JSON.stringify(s.urls).includes(OPENRELAY_STATIC_AUTH_HOST),
    );
    expect(turn).toBeTruthy();
    const expiry = Math.floor(nowMs / 1000) + ttlSec;
    expect(turn!.username).toBe(`${expiry}:guest`);
    const expected = createHmac("sha1", OPENRELAY_STATIC_AUTH_SECRET)
      .update(`${expiry}:guest`)
      .digest("base64");
    expect(turn!.credential).toBe(expected);
    expect(JSON.stringify(turn!.urls)).toContain("transport=tcp");
    expect(JSON.stringify(turn!.urls)).toContain("turns:");
  });

  it("createStunOnlyIceServers has no TURN entries", () => {
    const stun = createStunOnlyIceServers();
    expect(JSON.stringify(stun)).not.toContain("turn:");
  });
});
