/**
 * Detect / cancel Scratch Blockly block or workspace gestures so remote
 * collab reloads do not strand a live drag (cursor-stuck-until-reload).
 */

export interface ScratchGestureWorkspace {
  isDragging?: () => boolean;
  cancelCurrentGesture?: () => void;
}

export interface ScratchGestureBlocksApi {
  getMainWorkspace?: () => ScratchGestureWorkspace | null | undefined;
  Gesture?: {
    inProgress?: () => boolean;
  };
}

export const REMOTE_APPLY_DRAG_RETRY_MS = 100;
export const REMOTE_APPLY_DRAG_MAX_WAIT_MS = 8_000;

export function isScratchBlockInteractionActive(
  workspace: ScratchGestureWorkspace | null | undefined,
  blocksApi: ScratchGestureBlocksApi | null | undefined = (
    globalThis as unknown as {Blockly?: ScratchGestureBlocksApi}
  ).Blockly,
): boolean {
  try {
    if (blocksApi?.Gesture?.inProgress?.()) return true;
  } catch {
    // ignore
  }
  try {
    if (workspace?.isDragging?.()) return true;
  } catch {
    // ignore
  }
  return false;
}

export function cancelScratchBlockGesture(
  workspace: ScratchGestureWorkspace | null | undefined,
): boolean {
  if (!workspace || typeof workspace.cancelCurrentGesture !== "function") {
    return false;
  }
  try {
    workspace.cancelCurrentGesture();
    return true;
  } catch {
    return false;
  }
}

export type RemoteApplyInteractionDecision =
  | {action: "apply"}
  | {action: "defer"; delayMs: number}
  | {action: "cancel-then-apply"};

/**
 * While the user is dragging, keep deferring remote VM reloads. After the max
 * wait, cancel the gesture so apply can proceed without stranding listeners.
 */
export function decideRemoteApplyDuringInteraction(input: {
  interacting: boolean;
  waitedMs: number;
  retryMs?: number;
  maxWaitMs?: number;
}): RemoteApplyInteractionDecision {
  if (!input.interacting) return {action: "apply"};
  const retryMs = input.retryMs ?? REMOTE_APPLY_DRAG_RETRY_MS;
  const maxWaitMs = input.maxWaitMs ?? REMOTE_APPLY_DRAG_MAX_WAIT_MS;
  if (input.waitedMs >= maxWaitMs) return {action: "cancel-then-apply"};
  return {action: "defer", delayMs: retryMs};
}
