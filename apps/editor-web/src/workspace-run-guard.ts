/**
 * Keep "what you see on the workspace" aligned with what the VM is running.
 *
 * Learners report the sprite moving with an empty workspace. That can happen
 * when Blockly no longer shows scripts but the editing target still has VM
 * blocks / threads (delete events dropped, partial sync, etc.). When the
 * visible workspace has no top-level scripts, stop that target and clear any
 * leftover VM scripts so the stage matches the empty workspace.
 */

export type GuardWorkspaceLike = {
  isDragging?: () => boolean;
  getTopBlocks?: (ordered?: boolean) => Array<{
    isShadow?: () => boolean;
    type?: string;
  }>;
};

export type GuardTargetLike = {
  id?: string;
  blocks?: {
    getScripts?: () => string[];
    deleteAllBlocks?: () => void;
    getBlock?: (id: string) => unknown;
  };
};

export type GuardRuntimeLike = {
  threads?: Array<{
    target?: GuardTargetLike | null;
    updateMonitor?: boolean;
    isKilled?: boolean;
  }>;
  stopForTarget?: (target: GuardTargetLike) => void;
  stopAll?: () => void;
};

export type WorkspaceRunGuardResult = {
  stopped: boolean;
  clearedVmScripts: boolean;
};

function workspaceTopScriptCount(workspace: GuardWorkspaceLike | null | undefined): number | null {
  if (!workspace || typeof workspace.getTopBlocks !== "function") return null;
  try {
    const tops = workspace.getTopBlocks(false) ?? [];
    return tops.filter(block => {
      if (!block) return false;
      try {
        if (block.isShadow?.()) return false;
      } catch {
        // treat as a real block
      }
      return true;
    }).length;
  } catch {
    return null;
  }
}

function targetScriptCount(target: GuardTargetLike | null | undefined): number {
  const scripts = target?.blocks?.getScripts?.();
  return Array.isArray(scripts) ? scripts.length : 0;
}

function targetHasRunningThreads(
  runtime: GuardRuntimeLike,
  target: GuardTargetLike,
): boolean {
  const threads = runtime.threads;
  if (!Array.isArray(threads)) return false;
  return threads.some(
    thread =>
      thread &&
      !thread.updateMonitor &&
      !thread.isKilled &&
      thread.target != null &&
      (thread.target === target ||
        (typeof thread.target.id === "string" &&
          thread.target.id === target.id)),
  );
}

/**
 * If the Blockly workspace shows no scripts, stop the editing target and clear
 * any VM scripts still attached to it.
 *
 * Returns null when the workspace API is unavailable (so callers can skip).
 */
export function reconcileEmptyWorkspaceWithVm(options: {
  workspace: GuardWorkspaceLike | null | undefined;
  runtime: GuardRuntimeLike | null | undefined;
  editingTarget: GuardTargetLike | null | undefined;
}): WorkspaceRunGuardResult | null {
  const {workspace, runtime, editingTarget} = options;
  if (!runtime || !editingTarget?.blocks) return null;
  if (workspace?.isDragging?.()) {
    return {stopped: false, clearedVmScripts: false};
  }

  const visible = workspaceTopScriptCount(workspace);
  if (visible === null) return null;
  if (visible > 0) return {stopped: false, clearedVmScripts: false};

  const vmScripts = targetScriptCount(editingTarget);
  const running = targetHasRunningThreads(runtime, editingTarget);
  if (vmScripts === 0 && !running) {
    return {stopped: false, clearedVmScripts: false};
  }

  let stopped = false;
  if (running) {
    try {
      if (typeof runtime.stopForTarget === "function") {
        runtime.stopForTarget(editingTarget);
      } else {
        runtime.stopAll?.();
      }
      stopped = true;
    } catch {
      // Best-effort: still try to clear VM scripts below.
    }
  }

  let clearedVmScripts = false;
  if (vmScripts > 0 && typeof editingTarget.blocks.deleteAllBlocks === "function") {
    try {
      editingTarget.blocks.deleteAllBlocks();
      clearedVmScripts = true;
    } catch {
      // ignore
    }
  }

  return {stopped, clearedVmScripts};
}
