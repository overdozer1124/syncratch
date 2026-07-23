import {describe, expect, it} from "vitest";
import type {CollabState} from "./collab-session.js";
import {
  GOOGLE_DRIVE_STATUS_ICON_PATH,
  composeStatusIcons,
  formatPeopleBadge,
} from "./status-icons.js";

function collab(
  partial: Partial<CollabState> &
    Pick<
      CollabState,
      | "status"
      | "peerCount"
      | "bootstrapPhase"
      | "role"
      | "createdThisRoom"
      | "conflict"
    >,
): CollabState {
  return {
    epoch: null,
    receivedBytes: 0,
    issueCodes: [],
    signalingPeerCount: 0,
    joinedTopic: true,
    signalingError: null,
    expectedAssets: 0,
    verifiedAssets: 0,
    ...partial,
  };
}

describe("formatPeopleBadge", () => {
  it("shows bare counts up to four and ×N beyond", () => {
    expect(formatPeopleBadge(1)).toBe("1");
    expect(formatPeopleBadge(4)).toBe("4");
    expect(formatPeopleBadge(5)).toBe("×5");
  });
});

describe("Google Drive status mark", () => {
  it("points at the vendored official Drive product logo", () => {
    expect(GOOGLE_DRIVE_STATUS_ICON_PATH).toBe(
      "branding/google-drive-2026-color-64dp.png",
    );
  });
});

describe("composeStatusIcons", () => {
  it("builds online+crown and Google avatar for the host", () => {
    const icons = composeStatusIcons({
      local: "clean",
      drive: "disconnected",
      googleAvatarUrl: "https://lh3.googleusercontent.com/a/host",
      collab: collab({
        status: "connected",
        peerCount: 0,
        bootstrapPhase: "ready",
        role: "leader",
        createdThisRoom: true,
        conflict: false,
      }),
    });

    expect(icons.map(icon => icon.id)).toEqual([
      "local",
      "drive",
      "collab",
      "avatar",
    ]);
    expect(icons.find(icon => icon.id === "drive")?.tone).toBe("muted");
    const online = icons.find(icon => icon.id === "collab");
    expect(online?.kind).toBe("online");
    expect(online?.showCrown).toBe(true);
    expect(online?.label).toContain("ホスト");
    const avatar = icons.find(icon => icon.id === "avatar");
    expect(avatar?.kind).toBe("avatar");
    expect(avatar?.imageUrl).toBe("https://lh3.googleusercontent.com/a/host");
    expect(avatar?.hostRing).toBe(true);
    expect(avatar?.badge).toBe("1");
  });

  it("shows guest online without crown and people ×N when many peers join", () => {
    const icons = composeStatusIcons({
      local: "clean",
      drive: "synced",
      collab: collab({
        status: "connected",
        peerCount: 5,
        bootstrapPhase: "ready",
        role: "follower",
        createdThisRoom: false,
        conflict: false,
      }),
    });

    expect(icons.find(icon => icon.id === "drive")?.tone).toBe("active");
    expect(icons.find(icon => icon.id === "collab")?.showCrown).toBe(false);
    expect(icons.find(icon => icon.id === "avatar")?.badge).toBe("×6");
    expect(icons.find(icon => icon.id === "avatar")?.hostRing).toBe(false);
    expect(icons.find(icon => icon.id === "avatar")?.imageUrl).toBeUndefined();
  });

  it("hides Drive when not configured and omits collab when solo", () => {
    const icons = composeStatusIcons({
      local: "saving",
      drive: "not-configured",
      collab: null,
    });
    expect(icons.map(icon => icon.id)).toEqual(["local"]);
    expect(icons[0]?.tone).toBe("busy");
  });
});
