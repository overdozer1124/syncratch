import {describe, expect, it} from "vitest";
import {composeProjectStatus} from "./project-status.js";
import type {CollabState} from "./collab-session.js";

function collabState(partial: Partial<CollabState> & Pick<CollabState, "status" | "peerCount" | "bootstrapPhase" | "role" | "createdThisRoom" | "conflict" | "expectedAssets" | "verifiedAssets">): CollabState {
  return {
    epoch: null,
    receivedBytes: 0,
    issueCodes: [],
    ...partial,
  };
}

describe("composeProjectStatus", () => {
  it("uses local save state as the primary message", () => {
    const status = composeProjectStatus({
      local: "dirty",
      drive: "not-configured",
      collab: null,
    });

    expect(status.primary).toBe("Unsaved");
    expect(status.details).toBe("");
  });

  it("adds Drive and Collab backup details as secondary text", () => {
    const status = composeProjectStatus({
      local: "clean",
      drive: "synced",
      collab: collabState({
        status: "connected",
        peerCount: 2,
        bootstrapPhase: "ready",
        role: "leader",
        createdThisRoom: true,
        conflict: false,
        expectedAssets: 0,
        verifiedAssets: 0,
      }),
    });

    expect(status.primary).toBe("Saved");
    expect(status.details).toBe("Drive synced · 2 peers connected");
  });

  it("surfaces bootstrap and disconnected collab phases in details", () => {
    const receiving = composeProjectStatus({
      local: "saving",
      drive: "unsynced",
      collab: collabState({
        status: "connected",
        peerCount: 0,
        bootstrapPhase: "receiving-project",
        role: "follower",
        createdThisRoom: false,
        conflict: false,
        expectedAssets: 3,
        verifiedAssets: 1,
      }),
    });
    const disconnected = composeProjectStatus({
      local: "error",
      drive: "disconnected",
      collab: collabState({
        status: "disconnected",
        peerCount: 0,
        bootstrapPhase: "idle",
        role: "solo",
        createdThisRoom: false,
        conflict: false,
        expectedAssets: 0,
        verifiedAssets: 0,
      }),
    });

    expect(receiving.details).toContain("Collab receiving-project");
    expect(disconnected.details).toContain("Collab disconnected");
    expect(disconnected.details).toContain("Drive disconnected");
  });

  it("keeps a fatal boot error primary during later status recomposition", () => {
    const status = composeProjectStatus({
      local: "clean",
      drive: "not-configured",
      collab: null,
      fatalError: "IndexedDB failed to open",
    });

    expect(status.primary).toBe("Error");
    expect(status.details).toContain("IndexedDB failed to open");
  });

  it("keeps an import failure primary during secondary status updates", () => {
    const status = composeProjectStatus({
      local: "clean",
      localError: "Import failed",
      drive: "synced",
      collab: null,
    });

    expect(status.primary).toBe("Import failed");
    expect(status.details).toBe("Drive synced");
  });

  it("prioritizes collaboration disconnection over bootstrap progress", () => {
    const status = composeProjectStatus({
      local: "clean",
      drive: "not-configured",
      collab: collabState({
        status: "disconnected",
        peerCount: 0,
        bootstrapPhase: "receiving-project",
        role: "follower",
        createdThisRoom: false,
        conflict: false,
        expectedAssets: 2,
        verifiedAssets: 1,
      }),
    });

    expect(status.details).toBe("Collab disconnected");
  });
});
