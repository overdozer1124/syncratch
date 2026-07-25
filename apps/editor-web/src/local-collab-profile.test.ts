import {describe, expect, it} from "vitest";
import {
  LOCAL_COLLAB_PROFILE_STORAGE_KEY,
  avatarColorForSeed,
  buildLocalAvatarDataUrl,
  loadLocalCollabProfile,
  normalizeLocalDisplayName,
  resolveAdvertisedCollabProfile,
  saveLocalCollabProfile,
} from "./local-collab-profile.js";

describe("local collab profile", () => {
  it("normalizes and truncates display names", () => {
    expect(normalizeLocalDisplayName("  あいう  ")).toBe("あいう");
    expect(normalizeLocalDisplayName("x".repeat(40)).length).toBe(24);
  });

  it("persists and loads from storage", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
      removeItem: (key: string) => {
        map.delete(key);
      },
    };
    expect(saveLocalCollabProfile({displayName: "  みらい  "}, storage)).toEqual({
      displayName: "みらい",
    });
    expect(map.get(LOCAL_COLLAB_PROFILE_STORAGE_KEY)).toContain("みらい");
    expect(loadLocalCollabProfile(storage)).toEqual({displayName: "みらい"});
    expect(saveLocalCollabProfile({displayName: "   "}, storage)).toBeNull();
    expect(loadLocalCollabProfile(storage)).toBeNull();
  });

  it("builds a deterministic SVG avatar data URL", () => {
    const a = buildLocalAvatarDataUrl("p-abc", "みらい");
    const b = buildLocalAvatarDataUrl("p-abc", "みらい");
    expect(a).toBe(b);
    expect(a.startsWith("data:image/svg+xml,")).toBe(true);
    expect(decodeURIComponent(a)).toContain("み");
    expect(avatarColorForSeed("p-abc")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("prefers Google profile over local avatar", () => {
    expect(
      resolveAdvertisedCollabProfile({
        participantId: "p-1",
        googleDisplayName: "Host",
        googleAvatarUrl: "https://example/a.png",
        localDisplayName: "みらい",
      }),
    ).toEqual({
      displayName: "Host",
      avatarUrl: "https://example/a.png",
    });
    const local = resolveAdvertisedCollabProfile({
      participantId: "p-1",
      localDisplayName: "みらい",
    });
    expect(local.displayName).toBe("みらい");
    expect(local.avatarUrl?.startsWith("data:image/svg+xml,")).toBe(true);
  });
});
