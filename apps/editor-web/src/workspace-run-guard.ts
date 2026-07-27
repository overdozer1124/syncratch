/**
 * Detect when the Blockly workspace and VM scripts disagree, and stop execution.
 *
 * Learners report the sprite moving with an empty workspace. That can happen
 * when Blockly no longer shows scripts but the editing target still has VM
 * blocks / threads (partial sync, load failure, stale workspace, etc.).
 *
 * This module stops the editing target when a durable mismatch is observed.
 * It does NOT delete VM blocks — that would trigger autosave / collaboration
 * publish and can destroy recoverable data when the empty workspace is transient.
 */

import {
  hashBlockEdges,
  recordWorkspaceVmDesync,
  type WorkspaceVmDesyncEntry,
} from "./workspace-desync-diagnostics.js";

export type GuardWorkspaceLike = {
  id?: string;
  isDragging?: () => boolean;
  disposed?: boolean;
  getTopBlocks?: (ordered?: boolean) => Array<{
    id?: string;
    isShadow?: () => boolean;
    type?: string;
  }>;
};

export type GuardTargetLike = {
  id?: string;
  getName?: () => string;
  blocks?: {
    getScripts?: () => string[];
    getBlock?: (id: string) => unknown;
    _blocks?: Record<string, {parent?: string | null; next?: string | null}>;
  };
};

export type GuardRuntimeLike = {
  threads?: Array<{
    target?: GuardTargetLike | null;
    updateMonitor?: boolean;
    isKilled?: boolean;
    status?: number;
    topBlock?: string | null;
    peekStack?: () => string | null | undefined;
  }>;
  stopForTarget?: (target: GuardTargetLike) => void;
  stopAll?: () => void;
};

export type WorkspaceRunGuardResult = {
  detected: boolean;
  stopped: boolean;
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

function workspaceTopBlockIds(workspace: GuardWorkspaceLike | null | undefined): string[] {
  if (!workspace || typeof workspace.getTopBlocks !== "function") return [];
  try {
    return (workspace.getTopBlocks(false) ?? [])
      .filter(block => {
        if (!block) return false;
        try {
          return !block.isShadow?.();
        } catch {
          return true;
        }
      })
      .map(block => block.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

function targetScriptCount(target: GuardTargetLike | null | undefined): number {
  const scripts = target?.blocks?.getScripts?.();
  return Array.isArray(scripts) ? scripts.length : 0;
}

function vmBlockIds(target: GuardTargetLike | null | undefined): string[] {
  const raw = target?.blocks?._blocks;
  if (!raw || typeof raw !== "object") return [];
  return Object.keys(raw);
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
      thread.status !== 4 &&
      thread.target != null &&
      (thread.target === target ||
        (typeof thread.target.id === "string" &&
          thread.target.id === target.id)),
  );
}

function snapshotThreads(
  runtime: GuardRuntimeLike,
  target: GuardTargetLike,
): WorkspaceVmDesyncEntry["threads"] {
  const threads = runtime.threads;
  if (!Array.isArray(threads)) return [];
  return threads
    .filter(
      thread =>
        thread &&
        !thread.updateMonitor &&
        thread.target != null &&
        (thread.target === target ||
          (typeof thread.target.id === "string" &&
            thread.target.id === target.id)),
    )
    .map(thread => {
      let peek: string | null = null;
      try {
        const value = thread.peekStack?.();
        peek = typeof value === "string" ? value : null;
      } catch {
        peek = null;
      }
      return {
        targetId: thread.target?.id,
        topBlock: thread.topBlock ?? null,
        peekStack: peek,
        isKilled: thread.isKilled,
        status: thread.status,
      };
    });
}

function recordDesync(options: {
  workspace: GuardWorkspaceLike | null | undefined;
  runtime: GuardRuntimeLike;
  editingTarget: GuardTargetLike;
  visible: number;
  vmScripts: number;
  action: WorkspaceVmDesyncEntry["action"];
}): void {
  const {workspace, runtime, editingTarget, visible, vmScripts, action} = options;
  const blocklyTopIds = workspaceTopBlockIds(workspace);
  const vmIds = vmBlockIds(editingTarget);
  const vmBlocks = editingTarget.blocks?._blocks;
  recordWorkspaceVmDesync({
    editingTargetId: editingTarget.id,
    editingTargetName:
      typeof editingTarget.getName === "function"
        ? editingTarget.getName()
        : undefined,
    workspaceTopBlocks: visible,
    vmScriptCount: vmScripts,
    vmBlockIds: vmIds,
    vmEdgeHash: hashBlockEdges(vmBlocks, vmIds),
    blocklyTopBlockIds: blocklyTopIds,
    blocklyEdgeHash: blocklyTopIds.join("|"),
    threads: snapshotThreads(runtime, editingTarget),
    action,
  });
}

/**
 * If the Blockly workspace shows no scripts but the editing target still has
 * VM scripts or running threads, stop that target and record diagnostics.
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
  if (workspace?.disposed) return null;
  if (workspace?.isDragging?.()) {
    return {detected: false, stopped: false};
  }

  const visible = workspaceTopScriptCount(workspace);
  if (visible === null) return null;
  if (visible > 0) return {detected: false, stopped: false};

  const vmScripts = targetScriptCount(editingTarget);
  const running = targetHasRunningThreads(runtime, editingTarget);
  if (vmScripts === 0 && !running) {
    return {detected: false, stopped: false};
  }

  recordDesync({
    workspace,
    runtime,
    editingTarget,
    visible,
    vmScripts,
    action: "detected",
  });

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
      // Best-effort stop only.
    }
  }

  if (stopped) {
    recordDesync({
      workspace,
      runtime,
      editingTarget,
      visible,
      vmScripts,
      action: "stopped",
    });
  }

  return {detected: true, stopped};
}
