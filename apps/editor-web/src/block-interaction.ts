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
/** How often to re-check whether the project has stopped. */
export const REMOTE_APPLY_RUNNING_RETRY_MS = 250;

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
 * Decide whether a remote change may be applied to the VM right now.
 *
 * A remote apply is a full `vm.loadProject()`, and loadProject clears the
 * runtime — `dispose()` → `stopAll()` → `threads = []`. So applying while the
 * learner's project is running kills every thread it started: the green flag
 * and key hats appear to do nothing at all. Running therefore defers, and
 * unlike a drag it has no deadline: a game with a `forever` loop would blow
 * through any cap, and stopping someone's program to deliver an edit is the
 * behavior we are fixing. The edit is not lost — it stays in the shared doc
 * and lands as soon as the project stops.
 *
 * Dragging keeps its bounded wait: a gesture is short, and after the cap we
 * cancel it rather than strand the pointer.
 */
export function decideRemoteApplyDuringInteraction(input: {
  interacting: boolean;
  /** Non-monitor threads are live, i.e. the project is actually running. */
  running?: boolean;
  waitedMs: number;
  retryMs?: number;
  maxWaitMs?: number;
  runningRetryMs?: number;
}): RemoteApplyInteractionDecision {
  if (input.running) {
    return {
      action: "defer",
      delayMs: input.runningRetryMs ?? REMOTE_APPLY_RUNNING_RETRY_MS,
    };
  }
  if (!input.interacting) return {action: "apply"};
  const retryMs = input.retryMs ?? REMOTE_APPLY_DRAG_RETRY_MS;
  const maxWaitMs = input.maxWaitMs ?? REMOTE_APPLY_DRAG_MAX_WAIT_MS;
  if (input.waitedMs >= maxWaitMs) return {action: "cancel-then-apply"};
  return {action: "defer", delayMs: retryMs};
}
