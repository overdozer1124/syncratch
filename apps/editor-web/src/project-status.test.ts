import {describe, expect, it} from "vitest";
import {composeProjectStatus} from "./project-status.js";
import type {CollabState} from "./collab-session.js";

function collabState(partial: Partial<CollabState> & Pick<CollabState, "status" | "peerCount" | "bootstrapPhase" | "role" | "createdThisRoom" | "conflict" | "expectedAssets" | "verifiedAssets">): CollabState {
  return {
    epoch: null,
    receivedBytes: 0,
    issueCodes: [],
    signalingPeerCount: 0,
    joinedTopic: true,
    signalingError: null,
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

    expect(status.primary).toBe("変更を保存します…");
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

    expect(status.primary).toBe("このパソコンに保存しました");
    expect(status.details).toBe(
      "Google ドライブにも保存しました · 2人といっしょに作っています",
    );
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
        signalingPeerCount: 1,
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

    expect(receiving.details).toContain("作品を受け取り中…（素材 1/3）");
    expect(disconnected.details).toContain("友だちとのつながりが切れました");
    expect(disconnected.details).toContain(
      "Google ドライブ：つながっていません",
    );
  });

  it("keeps a fatal boot error primary during later status recomposition", () => {
    const status = composeProjectStatus({
      local: "clean",
      drive: "not-configured",
      collab: null,
      fatalError: "エディターを始められませんでした。ページを読み直してください。",
    });

    expect(status.primary).toBe("エラー");
    expect(status.details).toContain("ページを読み直してください");
  });

  it("keeps an import failure primary during secondary status updates", () => {
    const status = composeProjectStatus({
      local: "clean",
      localError: "作品ファイルを開けませんでした",
      drive: "synced",
      collab: null,
    });

    expect(status.primary).toBe("作品ファイルを開けませんでした");
    expect(status.details).toBe("Google ドライブにも保存しました");
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

    expect(status.details).toBe("友だちとのつながりが切れました");
  });

  it("explains an empty signaling room while the guest is waiting", () => {
    const status = composeProjectStatus({
      local: "clean",
      drive: "not-configured",
      collab: collabState({
        status: "connected",
        peerCount: 0,
        bootstrapPhase: "receiving-project",
        role: "follower",
        createdThisRoom: false,
        conflict: false,
        expectedAssets: 0,
        verifiedAssets: 0,
        signalingPeerCount: 0,
        joinedTopic: true,
      }),
    });

    expect(status.details).toContain("友だちの部屋が見つかりません");
  });
});
