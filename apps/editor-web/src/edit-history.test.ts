import {describe, expect, it, vi} from "vitest";
import {
  BLOCK_UNDO_FLOOR,
  canRedoBlocks,
  canUndoBlocks,
  captureUndoBeforeTargetSwitch,
  configureBlockWorkspaceUndo,
  createDeletionStackState,
  deletionButtonLabel,
  installPerTargetUndoKeepAlive,
  noteRestoreDeletionCandidate,
  popAndRestoreDeletion,
  redoBlocks,
  undoBlocks,
  type BlockWorkspaceLike,
  type TargetUndoStacks,
} from "./edit-history.js";

describe("edit-history deletion stack", () => {
  it("keeps multiple restore closures in order", () => {
    let state = createDeletionStackState();
    const first = vi.fn();
    const second = vi.fn();
    state = noteRestoreDeletionCandidate(state, {
      restorable: true,
      deletedItem: "Sprite1",
      restore: first,
    });
    state = noteRestoreDeletionCandidate(state, {
      restorable: true,
      deletedItem: "Sprite2",
      restore: second,
    });
    expect(state.entries).toHaveLength(2);
    expect(deletionButtonLabel(2, "Sprite2")).toContain("あと2かい");

    const popped = popAndRestoreDeletion(state);
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
    expect(popped.state.entries).toHaveLength(1);
    expect(popped.restored?.deletedItem).toBe("Sprite2");
  });

  it("ignores duplicate restoreFun announcements", () => {
    let state = createDeletionStackState();
    const restore = vi.fn();
    state = noteRestoreDeletionCandidate(state, {
      restorable: true,
      deletedItem: "A",
      restore,
    });
    state = noteRestoreDeletionCandidate(state, {
      restorable: true,
      deletedItem: "A",
      restore,
    });
    expect(state.entries).toHaveLength(1);
  });
});

describe("edit-history block undo", () => {
  it("configures MAX_UNDO and runs undo/redo", () => {
    const workspace: BlockWorkspaceLike = {
      MAX_UNDO: 10,
      undoStack_: [{id: 1}],
      redoStack_: [{id: 2}],
      undo: vi.fn(),
    };
    configureBlockWorkspaceUndo(workspace);
    expect(workspace.MAX_UNDO).toBe(BLOCK_UNDO_FLOOR);
    expect(canUndoBlocks(workspace)).toBe(true);
    expect(canRedoBlocks(workspace)).toBe(true);
    expect(undoBlocks(workspace)).toBe(true);
    expect(workspace.undo).toHaveBeenCalledWith(false);
    expect(redoBlocks(workspace)).toBe(true);
    expect(workspace.undo).toHaveBeenCalledWith(true);
  });

  it("keeps per-target undo stacks across clearUndo", () => {
    const stacks: TargetUndoStacks = new Map();
    let editingId: string | null = "sprite-a";
    const workspace: BlockWorkspaceLike = {
      undoStack_: [{op: "a1"}],
      redoStack_: [],
      clearUndo() {
        this.undoStack_ = [];
        this.redoStack_ = [];
      },
    };

    const dispose = installPerTargetUndoKeepAlive({
      workspace,
      stacks,
      getEditingTargetId: () => editingId,
    });

    editingId = captureUndoBeforeTargetSwitch({
      stacks,
      workspace,
      previousTargetId: "sprite-a",
      nextTargetId: "sprite-b",
    });
    expect(stacks.get("sprite-a")?.undo).toEqual([{op: "a1"}]);

    workspace.undoStack_ = [{op: "load-b"}];
    workspace.clearUndo?.();
    expect(workspace.undoStack_).toEqual([]);

    stacks.set("sprite-b", {undo: [{op: "b1"}], redo: []});
    workspace.clearUndo?.();
    expect(workspace.undoStack_).toEqual([{op: "b1"}]);

    dispose();
  });
});
