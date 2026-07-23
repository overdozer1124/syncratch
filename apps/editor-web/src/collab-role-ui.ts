import type {CollabState} from "./collab-session.js";
import type {EditorDriveStatus} from "./drive-integration.js";

/** Room-creator vs joiner — not Yjs leadership. */
export type CollabRoomRole = "host" | "guest";

export function collabRoomRole(
  state: Pick<CollabState, "createdThisRoom"> | null | undefined,
): CollabRoomRole | null {
  if (!state) return null;
  return state.createdThisRoom ? "host" : "guest";
}

export function collabRoomRoleLabel(role: CollabRoomRole): string {
  return role === "host"
    ? "あなたはホスト（リンクを作った人）"
    : "あなたはゲスト（友だちの作品に入っています）";
}

export function appendCollabRoomRole(
  statusText: string,
  state: Pick<CollabState, "createdThisRoom" | "status">,
): string {
  // Disconnected copy stays short; role is less actionable mid-outage.
  if (state.status === "disconnected") return statusText;
  const role = collabRoomRole(state);
  if (!role) return statusText;
  return `${statusText} · ${collabRoomRoleLabel(role)}`;
}

export const GUEST_DRIVE_SAVE_BLOCKED_STATUS =
  "ゲストのあいだは Google ドライブに保存できません。このパソコンには保存されます。";

export interface DriveControlFlags {
  connectDisabled: boolean;
  openDisabled: boolean;
  saveDisabled: boolean;
  disconnectDisabled: boolean;
  guestDriveBlocked: boolean;
}

export function driveControlFlags(input: {
  driveReady: boolean;
  status: EditorDriveStatus;
  collabGuest: boolean;
}): DriveControlFlags {
  const configured = input.status !== "not-configured";
  const connected = !["not-configured", "disconnected", "syncing"]
    .includes(input.status);
  const guestDriveBlocked = input.collabGuest;

  return {
    guestDriveBlocked,
    connectDisabled: !input.driveReady ||
      !configured ||
      input.status === "connected" ||
      input.status === "synced" ||
      input.status === "syncing" ||
      guestDriveBlocked,
    // Opening another Drive file mid-guest session would fork confusingly.
    openDisabled: !input.driveReady || !connected || guestDriveBlocked,
    saveDisabled: !input.driveReady || !connected || guestDriveBlocked,
    disconnectDisabled: !input.driveReady ||
      !configured ||
      input.status === "disconnected",
  };
}
