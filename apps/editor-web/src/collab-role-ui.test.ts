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

  it("disables Drive connect/open/save for collaboration guests", () => {
    const guest = driveControlFlags({
      driveReady: true,
      status: "synced",
      collabGuest: true,
    });
    expect(guest.guestDriveBlocked).toBe(true);
    expect(guest.connectDisabled).toBe(true);
    expect(guest.openDisabled).toBe(true);
    expect(guest.saveDisabled).toBe(true);
    expect(GUEST_DRIVE_SAVE_BLOCKED_STATUS).toContain("ゲスト");

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
