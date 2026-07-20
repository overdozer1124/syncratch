import type {LocalSaveState} from "./save-coordinator.js";
import type {EditorDriveStatus} from "./drive-integration.js";
import type {CollabState} from "./collab-session.js";

export interface ProjectStatusInput {
  local: LocalSaveState;
  drive: EditorDriveStatus;
  driveMessage?: string;
  collab: CollabState | null;
  collabIdleMessage?: string;
}

const localStatusText: Record<LocalSaveState, string> = {
  clean: "Saved",
  dirty: "Unsaved",
  saving: "Saving…",
  error: "Save failed",
  conflict: "Conflict",
};

const driveDetailText: Record<EditorDriveStatus, string | null> = {
  "not-configured": null,
  disconnected: "Drive disconnected",
  connected: "Drive connected",
  syncing: "Drive syncing",
  synced: "Drive synced",
  unsynced: "Drive unsynced",
  conflict: "Drive conflict",
};

function collabDetail(state: CollabState | null, idleMessage?: string): string | null {
  if (!state) return idleMessage && idleMessage !== "Solo" ? idleMessage : null;
  const peers = `${state.peerCount} ${state.peerCount === 1 ? "peer" : "peers"}`;
  if (state.bootstrapPhase !== "ready" && state.bootstrapPhase !== "idle") {
    return `Collab ${state.bootstrapPhase}`;
  }
  if (state.status === "disconnected") return "Collab disconnected";
  if (state.conflict) return `${peers} · Drive paused`;
  return `${peers} connected`;
}

export function composeProjectStatus(input: ProjectStatusInput): {
  primary: string;
  details: string;
} {
  const primary = localStatusText[input.local];
  const details = [
    input.driveMessage
      ? `${driveDetailText[input.drive] ?? "Drive"}: ${input.driveMessage}`
      : driveDetailText[input.drive],
    collabDetail(input.collab, input.collabIdleMessage),
  ]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
  return {primary, details};
}
