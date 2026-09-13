import {describe, expect, it} from "vitest";
import {createInvite, encodeInviteFragment} from "@blocksync/collab-invite";
import {
  PENDING_GUEST_JOIN_KEY,
  PENDING_HOST_CREATE_KEY,
  clearPendingHostRoomInvite,
  consumePendingGuestInvite,
  consumePendingHostCreate,
  ensureInviteHashOnLocation,
  markPendingHostCreate,
  peekPendingGuestInvite,
  peekPendingHostCreate,
  peekPendingHostRoomInvite,
  savePendingGuestInvite,
  savePendingHostRoomInvite,
  shouldGateCollabOnGoogle,
  stageCollabInviteFromLocation,
} from "./collab-oauth-gate.js";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    map,
  };
}

describe("collab oauth gate", () => {
  it("gates only when Drive is configured", () => {
    expect(shouldGateCollabOnGoogle("not-configured")).toBe(false);
    expect(shouldGateCollabOnGoogle("disconnected")).toBe(true);
    expect(shouldGateCollabOnGoogle("connected")).toBe(true);
  });

  it("marks and consumes pending host create once", () => {
    const storage = memoryStorage();
    markPendingHostCreate(storage);
    expect(storage.map.get(PENDING_HOST_CREATE_KEY)).toBe("1");
    expect(peekPendingHostCreate(storage)).toBe(true);
    expect(consumePendingHostCreate(storage)).toBe(true);
    expect(peekPendingHostCreate(storage)).toBe(false);
    expect(consumePendingHostCreate(storage)).toBe(false);
  });

  it("round-trips a pending guest invite fragment", () => {
    const storage = memoryStorage();
    const invite = createInvite();
    savePendingGuestInvite(invite, storage);
    expect(storage.map.get(PENDING_GUEST_JOIN_KEY)).toBeTruthy();
    expect(peekPendingGuestInvite(storage)?.roomId).toBe(invite.roomId);
    const consumed = consumePendingGuestInvite(storage);
    expect(consumed?.roomId).toBe(invite.roomId);
    expect(consumed?.secret).toBe(invite.secret);
    expect(consumePendingGuestInvite(storage)).toBeNull();
  });

  it("persists host room invite until cleared", () => {
    const storage = memoryStorage();
    const invite = createInvite();
    savePendingHostRoomInvite(invite, storage);
    expect(peekPendingHostRoomInvite(storage)?.roomId).toBe(invite.roomId);
    clearPendingHostRoomInvite(storage);
    expect(peekPendingHostRoomInvite(storage)).toBeNull();
  });

  it("stages guest invite from the location hash", () => {
    const storage = memoryStorage();
    const invite = createInvite();
    const fragment = encodeInviteFragment(invite);
    const hash = fragment.startsWith("#") ? fragment : `#${fragment}`;
    const locate = () =>
      ({
        pathname: "/s/token",
        search: "",
        hash,
      }) as Location;
    const staged = stageCollabInviteFromLocation(locate, storage);
    expect(staged?.roomId).toBe(invite.roomId);
    expect(peekPendingGuestInvite(storage)?.secret).toBe(invite.secret);
  });

  it("writes the invite hash onto the current location", () => {
    const invite = createInvite();
    const fragment = encodeInviteFragment(invite);
    const hash = fragment.startsWith("#") ? fragment : `#${fragment}`;
    let href = "https://example.test/app";
    const locate = () =>
      ({
        pathname: "/app",
        search: "",
        hash: href.includes("#") ? `#${href.split("#")[1]}` : "",
      }) as Location;
    ensureInviteHashOnLocation(invite, locate, url => {
      href = `https://example.test${url}`;
    });
    expect(href.endsWith(hash)).toBe(true);
  });
});
