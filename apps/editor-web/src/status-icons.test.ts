import {describe, expect, it} from "vitest";
import type {CollabState} from "./collab-session.js";
import {
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

describe("composeStatusIcons", () => {
  it("builds local, muted Drive, waiting collab, and host crown", () => {
    const icons = composeStatusIcons({
      local: "clean",
      drive: "disconnected",
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
      "role",
    ]);
    expect(icons.find(icon => icon.id === "drive")?.tone).toBe("muted");
    expect(icons.find(icon => icon.id === "collab")?.badge).toBe("1");
    expect(icons.find(icon => icon.id === "role")?.kind).toBe("crown");
    expect(icons.find(icon => icon.id === "role")?.label).toContain("ホスト");
  });

  it("shows guest role and people ×N when many peers join", () => {
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
    expect(icons.find(icon => icon.id === "collab")?.badge).toBe("×6");
    expect(icons.find(icon => icon.id === "role")?.kind).toBe("guest");
  });

  it("hides Drive when not configured and omits role when solo", () => {
    const icons = composeStatusIcons({
      local: "saving",
      drive: "not-configured",
      collab: null,
    });
    expect(icons.map(icon => icon.id)).toEqual(["local"]);
    expect(icons[0]?.tone).toBe("busy");
  });
});
