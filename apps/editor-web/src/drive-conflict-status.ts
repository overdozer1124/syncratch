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
