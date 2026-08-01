/**
 * Survive Google OAuth full-page redirects around collaboration start.
 *
 * Host create and guest join should authenticate *before* WebRTC starts, so a
 * mid-session OAuth reload does not drop the data channel. Invite secrets stay
 * in the URL hash (OAuth `return` param) or in sessionStorage intents.
 */

import {
  decodeInviteFragment,
  encodeInviteFragment,
  type CollabInvite,
} from "@blocksync/collab-invite";

export const PENDING_HOST_CREATE_KEY = "blocksync.pendingHostCreate";
export const PENDING_GUEST_JOIN_KEY = "blocksync.pendingGuestJoin";

export type SessionStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): SessionStorageLike | null {
  try {
    return typeof sessionStorage !== "undefined" ? sessionStorage : null;
  } catch {
    return null;
  }
}

/** Google Drive is configured on this deployment (OAuth or GIS). */
export function shouldGateCollabOnGoogle(driveStatus: string): boolean {
  return driveStatus !== "not-configured";
}

export function markPendingHostCreate(
  storage: SessionStorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(PENDING_HOST_CREATE_KEY, "1");
  } catch {
    // private mode
  }
}

export function peekPendingHostCreate(
  storage: SessionStorageLike | null = defaultStorage(),
): boolean {
  try {
    return storage?.getItem(PENDING_HOST_CREATE_KEY) === "1";
  } catch {
    return false;
  }
}

export function consumePendingHostCreate(
  storage: SessionStorageLike | null = defaultStorage(),
): boolean {
  try {
    if (storage?.getItem(PENDING_HOST_CREATE_KEY) !== "1") return false;
    storage.removeItem(PENDING_HOST_CREATE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function savePendingGuestInvite(
  invite: CollabInvite,
  storage: SessionStorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(PENDING_GUEST_JOIN_KEY, encodeInviteFragment(invite));
  } catch {
    // private mode
  }
}

export function consumePendingGuestInvite(
  storage: SessionStorageLike | null = defaultStorage(),
): CollabInvite | null {
  try {
    if (!storage) return null;
    const raw = storage.getItem(PENDING_GUEST_JOIN_KEY);
    if (!raw) return null;
    storage.removeItem(PENDING_GUEST_JOIN_KEY);
    return decodeInviteFragment(raw.startsWith("#") ? raw : `#${raw}`);
  } catch {
    return null;
  }
}

export function peekPendingGuestInvite(
  storage: SessionStorageLike | null = defaultStorage(),
): CollabInvite | null {
  try {
    const raw = storage?.getItem(PENDING_GUEST_JOIN_KEY);
    if (!raw) return null;
    return decodeInviteFragment(raw.startsWith("#") ? raw : `#${raw}`);
  } catch {
    return null;
  }
}

/**
 * Put the invite hash on the current URL (no reload) so OAuth `return`
 * includes it and boot can auto-join after Google comes back.
 */
export function ensureInviteHashOnLocation(
  invite: CollabInvite,
  locate: () => Location = () => window.location,
  replaceUrl: (url: string) => void = url =>
    window.history.replaceState({}, "", url),
): void {
  const location = locate();
  const fragment = encodeInviteFragment(invite);
  const hash = fragment.startsWith("#") ? fragment : `#${fragment}`;
  if (location.hash === hash) return;
  replaceUrl(`${location.pathname}${location.search}${hash}`);
}

export const COLLAB_GOOGLE_CONNECT_HINT =
  "Google アカウントとつないでから、いっしょに作ります…";

export const COLLAB_GOOGLE_REQUIRED_FOR_JOIN =
  "Google とつないでから、友だちの作品に入れます。";

export const COLLAB_GOOGLE_REQUIRED_FOR_CREATE =
  "リンクを作る前に Google とつなぎます。";

/** Shown when host OAuth returns `drive_oauth=error` (cancel, missing refresh, etc.). */
export const COLLAB_GOOGLE_OAUTH_FAILED =
  "Google アカウントとの接続ができませんでした。アカウントを選び直すか、「Google とつなぐ」をもう一度押してください。";
