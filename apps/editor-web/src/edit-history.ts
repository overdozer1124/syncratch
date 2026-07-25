/**
 * Longer edit undo for Syncratch:
 * - Blockly block undo/redo (with per-sprite stack keep-alive)
 * - Multi-level restore stack for deleted sprites/costumes/sounds
 */

export const MAX_DELETION_STACK = 20;
/** Scratch default is 1024; keep a generous floor for kids' long sessions. */
export const BLOCK_UNDO_FLOOR = 1024;

export type BlockWorkspaceLike = {
  undo?: (redo: boolean) => void;
  hasUndoStack?: () => boolean;
  hasRedoStack?: () => boolean;
  clearUndo?: () => void;
  MAX_UNDO?: number;
  undoStack_?: unknown[];
  redoStack_?: unknown[];
  addChangeListener?: (listener: (event: unknown) => void) => void;
  removeChangeListener?: (listener: (event: unknown) => void) => void;
};

export type DeletionStackEntry = {
  restore: () => void;
  deletedItem: string;
};

export type DeletionStackState = {
  entries: DeletionStackEntry[];
  lastSeenRestore: (() => void) | null;
};

export function createDeletionStackState(): DeletionStackState {
  return {entries: [], lastSeenRestore: null};
}

/** Capture a newly announced Scratch restoreFun into our multi-level stack. */
export function noteRestoreDeletionCandidate(
  state: DeletionStackState,
  candidate: {restorable: boolean; deletedItem: string; restore: (() => void) | null},
  max = MAX_DELETION_STACK,
): DeletionStackState {
  if (!candidate.restorable || !candidate.restore) return state;
  if (candidate.restore === state.lastSeenRestore) return state;
  const entries = [
    ...state.entries,
    {restore: candidate.restore, deletedItem: candidate.deletedItem},
  ];
  while (entries.length > max) entries.shift();
  return {entries, lastSeenRestore: candidate.restore};
}

export function deletionStackDepth(state: DeletionStackState): number {
  return state.entries.length;
}

export function peekDeletion(state: DeletionStackState): DeletionStackEntry | null {
  return state.entries[state.entries.length - 1] ?? null;
}

export function popAndRestoreDeletion(state: DeletionStackState): {
  state: DeletionStackState;
  restored: DeletionStackEntry | null;
} {
  if (state.entries.length === 0) {
    return {state, restored: null};
  }
  const entries = state.entries.slice();
  const restored = entries.pop() ?? null;
  if (!restored) return {state, restored: null};
  try {
    restored.restore();
  } catch {
    return {
      state: {...state, entries},
      restored: null,
    };
  }
  return {
    state: {
      entries,
      lastSeenRestore:
        state.lastSeenRestore === restored.restore
          ? null
          : state.lastSeenRestore,
    },
    restored,
  };
}

export function configureBlockWorkspaceUndo(
  workspace: BlockWorkspaceLike | null | undefined,
): void {
  if (!workspace) return;
  if (
    typeof workspace.MAX_UNDO !== "number" ||
    workspace.MAX_UNDO < BLOCK_UNDO_FLOOR
  ) {
    workspace.MAX_UNDO = BLOCK_UNDO_FLOOR;
  }
}

export type TargetUndoStacks = Map<
  string,
  {undo: unknown[]; redo: unknown[]}
>;

function cloneStack(stack: unknown[] | undefined): unknown[] {
  return Array.isArray(stack) ? stack.slice() : [];
}

export function snapshotTargetUndo(
  stacks: TargetUndoStacks,
  targetId: string | null | undefined,
  workspace: BlockWorkspaceLike | null | undefined,
): void {
  if (!targetId || !workspace) return;
  stacks.set(targetId, {
    undo: cloneStack(workspace.undoStack_),
    redo: cloneStack(workspace.redoStack_),
  });
}

export function restoreTargetUndo(
  stacks: TargetUndoStacks,
  targetId: string | null | undefined,
  workspace: BlockWorkspaceLike | null | undefined,
): boolean {
  if (!targetId || !workspace) return false;
  const saved = stacks.get(targetId);
  if (!saved) return false;
  workspace.undoStack_ = saved.undo.slice();
  workspace.redoStack_ = saved.redo.slice();
  return true;
}

/**
 * Call when the editing target is about to change, while the workspace still
 * holds the previous sprite's undo stack.
 */
export function captureUndoBeforeTargetSwitch(options: {
  stacks: TargetUndoStacks;
  workspace: BlockWorkspaceLike | null | undefined;
  previousTargetId: string | null | undefined;
  nextTargetId: string | null | undefined;
}): string | null {
  const previous = options.previousTargetId ?? null;
  const next = options.nextTargetId ?? null;
  if (previous && next && previous !== next) {
    snapshotTargetUndo(options.stacks, previous, options.workspace);
  }
  return next;
}

/**
 * Scratch clears Blockly undo on every sprite switch. After that clear, restore
 * the saved stack for the newly selected sprite (if any).
 */
export function installPerTargetUndoKeepAlive(options: {
  workspace: BlockWorkspaceLike;
  stacks: TargetUndoStacks;
  getEditingTargetId: () => string | null | undefined;
}): () => void {
  const {workspace, stacks, getEditingTargetId} = options;
  configureBlockWorkspaceUndo(workspace);
  if (typeof workspace.clearUndo !== "function") {
    return () => {};
  }
  const originalClear = workspace.clearUndo.bind(workspace);

  workspace.clearUndo = () => {
    originalClear();
    restoreTargetUndo(stacks, getEditingTargetId(), workspace);
  };

  return () => {
    workspace.clearUndo = originalClear;
  };
}

export function canUndoBlocks(
  workspace: BlockWorkspaceLike | null | undefined,
): boolean {
  if (!workspace) return false;
  if (typeof workspace.hasUndoStack === "function") {
    return workspace.hasUndoStack();
  }
  return Array.isArray(workspace.undoStack_) && workspace.undoStack_.length > 0;
}

export function canRedoBlocks(
  workspace: BlockWorkspaceLike | null | undefined,
): boolean {
  if (!workspace) return false;
  if (typeof workspace.hasRedoStack === "function") {
    return workspace.hasRedoStack();
  }
  return Array.isArray(workspace.redoStack_) && workspace.redoStack_.length > 0;
}

export function undoBlocks(
  workspace: BlockWorkspaceLike | null | undefined,
): boolean {
  if (!workspace || typeof workspace.undo !== "function") return false;
  if (!canUndoBlocks(workspace)) return false;
  workspace.undo(false);
  return true;
}

export function redoBlocks(
  workspace: BlockWorkspaceLike | null | undefined,
): boolean {
  if (!workspace || typeof workspace.undo !== "function") return false;
  if (!canRedoBlocks(workspace)) return false;
  workspace.undo(true);
  return true;
}

export function deletionButtonLabel(
  depth: number,
  deletedItem: string,
): string {
  if (depth <= 0) return "けしたものを もどす";
  const base =
    /sprite|スプライト/i.test(deletedItem)
      ? "けした スプライトを もどす"
      : /sound|おと|音/i.test(deletedItem)
        ? "けした おとを もどす"
        : /costume|衣装|すがた/i.test(deletedItem)
          ? "けした すがたを もどす"
          : "けしたものを もどす";
  return depth > 1 ? `${base}（あと${depth}かい）` : base;
}
