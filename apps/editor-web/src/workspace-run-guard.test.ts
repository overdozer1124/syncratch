import {describe, expect, it, vi} from "vitest";
import {reconcileEmptyWorkspaceWithVm} from "./workspace-run-guard.js";

describe("reconcileEmptyWorkspaceWithVm", () => {
  it("does nothing when the workspace still shows scripts", () => {
    const deleteAllBlocks = vi.fn();
    const stopForTarget = vi.fn();
    const target = {
      id: "s1",
      blocks: {
        getScripts: () => ["hat"],
        deleteAllBlocks,
      },
    };
    const result = reconcileEmptyWorkspaceWithVm({
      workspace: {
        getTopBlocks: () => [{type: "event_whenflagclicked"}],
      },
      runtime: {threads: [], stopForTarget},
      editingTarget: target,
    });
    expect(result).toEqual({stopped: false, clearedVmScripts: false});
    expect(deleteAllBlocks).not.toHaveBeenCalled();
    expect(stopForTarget).not.toHaveBeenCalled();
  });

  it("stops threads and clears VM scripts when Blockly is empty", () => {
    const deleteAllBlocks = vi.fn();
    const stopForTarget = vi.fn();
    const target = {
      id: "s1",
      blocks: {
        getScripts: () => ["hat"],
        deleteAllBlocks,
      },
    };
    const result = reconcileEmptyWorkspaceWithVm({
      workspace: {getTopBlocks: () => []},
      runtime: {
        threads: [{target, updateMonitor: false}],
        stopForTarget,
      },
      editingTarget: target,
    });
    expect(result).toEqual({stopped: true, clearedVmScripts: true});
    expect(stopForTarget).toHaveBeenCalledWith(target);
    expect(deleteAllBlocks).toHaveBeenCalledTimes(1);
  });

  it("skips while the learner is dragging blocks", () => {
    const deleteAllBlocks = vi.fn();
    const target = {
      id: "s1",
      blocks: {getScripts: () => ["hat"], deleteAllBlocks},
    };
    const result = reconcileEmptyWorkspaceWithVm({
      workspace: {
        isDragging: () => true,
        getTopBlocks: () => [],
      },
      runtime: {threads: [{target}], stopForTarget: vi.fn()},
      editingTarget: target,
    });
    expect(result).toEqual({stopped: false, clearedVmScripts: false});
    expect(deleteAllBlocks).not.toHaveBeenCalled();
  });

  it("returns null when Blockly cannot be inspected", () => {
    expect(
      reconcileEmptyWorkspaceWithVm({
        workspace: {},
        runtime: {threads: []},
        editingTarget: {id: "s1", blocks: {getScripts: () => ["hat"]}},
      }),
    ).toBeNull();
  });
});
