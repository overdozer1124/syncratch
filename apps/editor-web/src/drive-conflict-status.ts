import type {EditorDriveStatus} from "./drive-integration.js";

export type DriveConflictAction = "report" | "clear" | "none";

export function driveConflictAction(
  status: EditorDriveStatus,
): DriveConflictAction {
  if (status === "conflict") return "report";
  if (status === "synced" || status === "disconnected" || status === "not-configured") {
    return "clear";
  }
  return "none";
}

/**
 * Clearing collab conflict on Drive disconnect is correct (room continues),
 * but observations are wiped so the next save can silently overwrite Drive.
 * Latch an explicit confirmation requirement across that transition.
 */
export function shouldLatchDriveOverwriteConfirmation(
  previousStatus: EditorDriveStatus,
  nextStatus: EditorDriveStatus,
): boolean {
  if (previousStatus !== "conflict") return false;
  return nextStatus === "disconnected" || nextStatus === "not-configured";
}

export const DRIVE_OVERWRITE_CONFIRMATION_REASON =
  "Confirm Drive overwrite after a previous conflict";
