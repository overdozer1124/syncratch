import {describe, expect, it} from "vitest";
import {isLinkExpiresAtInPast, parseLinkExpiresAt} from "./link-expiry.js";

describe("parseLinkExpiresAt", () => {
  it("accepts nullish and valid ISO strings", () => {
    expect(parseLinkExpiresAt(null)).toEqual({ok: true, expiresAt: null});
    expect(parseLinkExpiresAt("")).toEqual({ok: true, expiresAt: null});
    const parsed = parseLinkExpiresAt("2030-01-01T00:00:00.000Z");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.expiresAt).toBe("2030-01-01T00:00:00.000Z");
    }
  });

  it("rejects invalid values", () => {
    expect(parseLinkExpiresAt(123)).toEqual({
      ok: false,
      code: "INVALID_EXPIRES_AT",
    });
    expect(parseLinkExpiresAt("not-a-date")).toEqual({
      ok: false,
      code: "INVALID_EXPIRES_AT",
    });
  });
});

describe("isLinkExpiresAtInPast", () => {
  it("detects past expiry", () => {
    expect(
      isLinkExpiresAtInPast("2020-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
    ).toBe(true);
    expect(
      isLinkExpiresAtInPast("2030-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"),
    ).toBe(false);
  });
});
