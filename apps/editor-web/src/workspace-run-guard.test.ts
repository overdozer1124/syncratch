import {beforeEach, describe, expect, it, vi} from "vitest";
import {clearWorkspaceVmDesyncLog, getWorkspaceVmDesyncLog} from "./workspace-desync-diagnostics.js";
import {reconcileEmptyWorkspaceWithVm} from "./workspace-run-guard.js";

describe("reconcileEmptyWorkspaceWithVm", () => {
  beforeEach(() => {
    clearWorkspaceVmDesyncLog();
  });

  it("does nothing when the workspace still shows scripts", () => {
    const stopForTarget = vi.fn();
    const target = {
      id: "s1",
      blocks: {
        getScripts: () => ["hat"],
        _blocks: {hat: {parent: null, next: null}},
      },
    };
    const result = reconcileEmptyWorkspaceWithVm({
      workspace: {
        getTopBlocks: () => [{id: "hat", type: "event_whenflagclicked"}],
      },
      runtime: {threads: [], stopForTarget},
      editingTarget: target,
    });
    expect(result).toEqual({detected: false, stopped: false});
    expect(stopForTarget).not.toHaveBeenCalled();
    expect(getWorkspaceVmDesyncLog()).toHaveLength(0);
  });

  it("stops threads but keeps VM scripts when Blockly is empty", () => {
    const stopForTarget = vi.fn();
    const target = {
      id: "s1",
      blocks: {
        getScripts: () => ["hat"],
        _blocks: {hat: {parent: null, next: "move"}, move: {parent: "hat", next: null}},
      },
    };
    const result = reconcileEmptyWorkspaceWithVm({
      workspace: {getTopBlocks: () => []},
      runtime: {
        threads: [{target, updateMonitor: false, topBlock: "hat"}],
        stopForTarget,
      },
      editingTarget: target,
    });
    expect(result).toEqual({detected: true, stopped: true});
    expect(stopForTarget).toHaveBeenCalledWith(target);
    expect(target.blocks.getScripts()).toEqual(["hat"]);
    const log = getWorkspaceVmDesyncLog();
    expect(log.length).toBeGreaterThanOrEqual(1);
    expect(log[0]?.vmScriptCount).toBe(1);
    expect(log[0]?.workspaceTopBlocks).toBe(0);
  });

  it("records desync when VM scripts remain but nothing is running", () => {
    const target = {
      id: "s1",
      blocks: {
        getScripts: () => ["hat"],
        _blocks: {hat: {parent: null, next: null}},
      },
    };
    const result = reconcileEmptyWorkspaceWithVm({
      workspace: {getTopBlocks: () => []},
      runtime: {threads: []},
      editingTarget: target,
    });
    expect(result).toEqual({detected: true, stopped: false});
    expect(getWorkspaceVmDesyncLog()[0]?.action).toBe("detected");
  });

  it("skips while the learner is dragging blocks", () => {
    const target = {
      id: "s1",
      blocks: {getScripts: () => ["hat"], _blocks: {hat: {}}},
    };
    const result = reconcileEmptyWorkspaceWithVm({
      workspace: {
        isDragging: () => true,
        getTopBlocks: () => [],
      },
      runtime: {threads: [{target}], stopForTarget: vi.fn()},
      editingTarget: target,
    });
    expect(result).toEqual({detected: false, stopped: false});
  });

  it("skips disposed workspaces", () => {
    const target = {
      id: "s1",
      blocks: {getScripts: () => ["hat"]},
    };
    expect(
      reconcileEmptyWorkspaceWithVm({
        workspace: {disposed: true, getTopBlocks: () => []},
        runtime: {threads: [{target}]},
        editingTarget: target,
      }),
    ).toBeNull();
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
