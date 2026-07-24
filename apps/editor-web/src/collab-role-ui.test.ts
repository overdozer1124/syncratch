import {describe, expect, it} from "vitest";
import {
  GUEST_DRIVE_SAVE_BLOCKED_STATUS,
  appendCollabRoomRole,
  collabRoomRole,
  collabRoomRoleLabel,
  driveControlFlags,
} from "./collab-role-ui.js";

describe("collab room role UI", () => {
  it("maps createdThisRoom to host vs guest labels", () => {
    expect(collabRoomRole({createdThisRoom: true})).toBe("host");
    expect(collabRoomRole({createdThisRoom: false})).toBe("guest");
    expect(collabRoomRoleLabel("host")).toContain("ホスト");
    expect(collabRoomRoleLabel("guest")).toContain("ゲスト");
  });

  it("appends host/guest to live collab status but not when disconnected", () => {
    expect(
      appendCollabRoomRole("1人といっしょに作っています", {
        createdThisRoom: true,
        status: "connected",
      }),
    ).toContain("あなたはホスト");
    expect(
      appendCollabRoomRole("1人といっしょに作っています", {
        createdThisRoom: false,
        status: "connected",
      }),
    ).toContain("あなたはゲスト");
    expect(
      appendCollabRoomRole("友だちとのつながりが切れました", {
        createdThisRoom: false,
        status: "disconnected",
      }),
    ).toBe("友だちとのつながりが切れました");
  });

  it("blocks Drive open/save for guests but allows Google connect for presence", () => {
    const guestSynced = driveControlFlags({
      driveReady: true,
      status: "synced",
      collabGuest: true,
    });
    expect(guestSynced.guestDriveBlocked).toBe(true);
    expect(guestSynced.connectDisabled).toBe(true);
    expect(guestSynced.openDisabled).toBe(true);
    expect(guestSynced.saveDisabled).toBe(true);
    expect(GUEST_DRIVE_SAVE_BLOCKED_STATUS).toContain("ゲスト");

    const guestDisconnected = driveControlFlags({
      driveReady: true,
      status: "disconnected",
      collabGuest: true,
    });
    expect(guestDisconnected.connectDisabled).toBe(false);
    expect(guestDisconnected.saveDisabled).toBe(true);

    const host = driveControlFlags({
      driveReady: true,
      status: "synced",
      collabGuest: false,
    });
    expect(host.saveDisabled).toBe(false);
    expect(host.openDisabled).toBe(false);
    expect(host.connectDisabled).toBe(true);
  });
});
