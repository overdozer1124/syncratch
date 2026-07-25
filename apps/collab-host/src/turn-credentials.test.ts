import {createHmac} from "node:crypto";
import {describe, expect, it} from "vitest";
import {
  OPENRELAY_STATIC_AUTH_SECRET,
  mintOpenRelayIceServers,
} from "./turn-credentials.js";

describe("mintOpenRelayIceServers", () => {
  it("matches HMAC-SHA1 TURN REST credentials", () => {
    const nowMs = 1_700_000_000_000;
    const ttlSec = 3600;
    const {iceServers} = mintOpenRelayIceServers({
      nowMs,
      ttlSec,
      userId: "host",
    });
    const turn = iceServers.find(s =>
      JSON.stringify(s.urls).includes("staticauth.openrelay.metered.ca"),
    );
    const expiry = Math.floor(nowMs / 1000) + ttlSec;
    expect(turn?.username).toBe(`${expiry}:host`);
    expect(turn?.credential).toBe(
      createHmac("sha1", OPENRELAY_STATIC_AUTH_SECRET)
        .update(`${expiry}:host`)
        .digest("base64"),
    );
  });
});
