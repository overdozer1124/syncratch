import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {clearWorkspaceVmDesyncLog, getWorkspaceVmDesyncLog} from "./workspace-desync-diagnostics.js";
import {reconcileEmptyWorkspaceWithVm} from "./workspace-run-guard.js";
import {
  clearLastWorkspaceUpdateError,
  installWorkspaceUpdateErrorCapture,
} from "./workspace-update-error-log.js";

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

/**
 * The reviewer's headline path: `Blocks.onWorkspaceUpdate` catches a failure
 * from `clearWorkspaceAndLoadFromXml` — leaving the workspace cleared but not
 * reloaded — logs it, and lets the VM keep running over the incomplete
 * workspace. That is an empty workspace over a VM that still holds the
 * scripts, which is exactly what the learner reports.
 */
describe("a workspace left empty by a failed XML load", () => {
  let disposeCapture: (() => void) | null = null;

  beforeEach(() => {
    clearWorkspaceVmDesyncLog();
    clearLastWorkspaceUpdateError();
  });

  afterEach(() => {
    disposeCapture?.();
    disposeCapture = null;
    clearLastWorkspaceUpdateError();
  });

  it("stops the target, keeps the scripts, and records why", () => {
    const fakeConsole = {log: vi.fn(), error: vi.fn()};
    disposeCapture = installWorkspaceUpdateErrorCapture(fakeConsole, () => 42);

    const deleteAllBlocks = vi.fn();
    const stopForTarget = vi.fn();
    const target = {
      id: "s1",
      getName: () => "ネコ",
      blocks: {
        getScripts: () => ["hat"],
        deleteAllBlocks,
        _blocks: {
          hat: {parent: null, next: "move"},
          move: {parent: "hat", next: null},
        },
      },
    };

    // scratch-gui clears the workspace, then the XML load throws and is logged.
    fakeConsole.log("scratch-gui Workspace Update Error: unknown block pen_x");

    const result = reconcileEmptyWorkspaceWithVm({
      workspace: {id: "ws-7", getTopBlocks: () => []},
      runtime: {
        threads: [{target, topBlock: "hat", status: 0}],
        stopForTarget,
      },
      editingTarget: target,
      loadGeneration: 3,
    });

    expect(result).toEqual({detected: true, stopped: true});
    expect(stopForTarget).toHaveBeenCalledWith(target);
    // The learner's code must survive: stopping is the remedy, deleting is not.
    expect(deleteAllBlocks).not.toHaveBeenCalled();

    const log = getWorkspaceVmDesyncLog();
    expect(log.length).toBeGreaterThan(0);
    const detected = log[0]!;
    expect(detected.workspaceId).toBe("ws-7");
    expect(detected.loadGeneration).toBe(3);
    expect(detected.lastWorkspaceUpdateError).toEqual({
      message: "Workspace Update Error: unknown block pen_x",
      at: 42,
    });
    expect(detected.vmScriptCount).toBe(1);
    expect(detected.workspaceTopBlocks).toBe(0);
  });

  it("records no XML error when the workspace emptied for some other reason", () => {
    const target = {
      id: "s1",
      blocks: {
        getScripts: () => ["hat"],
        _blocks: {hat: {parent: null, next: null}},
      },
    };
    reconcileEmptyWorkspaceWithVm({
      workspace: {id: "ws-1", getTopBlocks: () => []},
      runtime: {threads: [], stopForTarget: vi.fn()},
      editingTarget: target,
      loadGeneration: 1,
    });

    const log = getWorkspaceVmDesyncLog();
    expect(log[0]?.lastWorkspaceUpdateError).toBeUndefined();
    expect(log[0]?.workspaceId).toBe("ws-1");
  });

  it("keeps a later load generation as its own entry, not a repeat", () => {
    const target = {
      id: "s1",
      blocks: {
        getScripts: () => ["hat"],
        _blocks: {hat: {parent: null, next: null}},
      },
    };
    const call = (loadGeneration: number) =>
      reconcileEmptyWorkspaceWithVm({
        workspace: {id: "ws-1", getTopBlocks: () => []},
        runtime: {threads: [], stopForTarget: vi.fn()},
        editingTarget: target,
        loadGeneration,
      });

    call(1);
    call(1);
    expect(getWorkspaceVmDesyncLog()).toHaveLength(1);
    call(2);
    expect(getWorkspaceVmDesyncLog()).toHaveLength(2);
  });
});
