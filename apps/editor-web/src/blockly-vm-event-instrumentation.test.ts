import {beforeEach, describe, expect, it, vi} from "vitest";
import {
  classifyMoveEvent,
  clearBlocklyVmEventInstrumentation,
  getBlocklyEventLog,
  getBlocklyVmGraphDiffLog,
  getSyncGeneration,
  installBlocklyVmEventPipeline,
  isGraphMutatingBlocklyEvent,
  type BlocklyEventLike,
  recordBlocklyEvent,
  recordBlocklyVmGraphDiff,
  rebindWorkspaceBlockListener,
  uninstallBlocklyVmEventPipeline,
} from "./blockly-vm-event-instrumentation.js";

const baseContext = {
  loadEpoch: 1,
  suppressVmChanges: false,
  diagnosticReady: true,
  uiRestoreEpoch: 2,
  collaborationGeneration: 3,
  projectSessionId: 4,
  saveDirtyGeneration: 5,
  editingTargetId: "sprite1",
};

describe("blockly-vm-event-instrumentation", () => {
  beforeEach(() => {
    clearBlocklyVmEventInstrumentation();
  });

  it("classifies graph-mutating Blockly events", () => {
    expect(isGraphMutatingBlocklyEvent({type: "create"})).toBe(true);
    expect(isGraphMutatingBlocklyEvent({type: "delete"})).toBe(true);
    expect(isGraphMutatingBlocklyEvent({type: "move"})).toBe(true);
    expect(isGraphMutatingBlocklyEvent({type: "change", element: "field"})).toBe(
      false,
    );
    expect(
      isGraphMutatingBlocklyEvent({type: "change", element: "mutation"}),
    ).toBe(true);
  });

  it("classifies move vs connection-change", () => {
    expect(
      classifyMoveEvent({type: "move", newCoordinate: {x: 1, y: 2}}),
    ).toBe("move");
    expect(
      classifyMoveEvent({
        type: "move",
        oldParentId: "a",
        newParentId: "b",
      }),
    ).toBe("connection-change");
  });

  it("records events with monotonic syncGeneration", () => {
    const first = recordBlocklyEvent({type: "create", blockId: "a"}, baseContext);
    const second = recordBlocklyEvent({type: "delete", blockId: "a"}, baseContext);
    expect(first.syncGeneration).toBe(1);
    expect(second.syncGeneration).toBe(2);
    expect(getSyncGeneration()).toBe(2);
    expect(getBlocklyEventLog()).toHaveLength(2);
  });

  it("records graph diff mismatch when Blockly and VM diverge", () => {
    const event = recordBlocklyEvent({type: "delete", blockId: "hat"}, baseContext);
    const diff = recordBlocklyVmGraphDiff({
      afterEvent: event,
      context: baseContext,
      workspace: {
        getAllBlocks: () => [],
      },
      editingTarget: {
        blocks: {
          getScripts: () => ["hat"],
          _blocks: {
            hat: {parent: null, next: null, shadow: false, inputs: {}},
          },
        },
      },
    });
    expect(diff?.mismatch).toBe(true);
    expect(diff?.syncGeneration).toBe(event.syncGeneration);
    expect(getBlocklyVmGraphDiffLog()).toHaveLength(1);
  });

  it("wraps vm.blockListener and drops before VM intake when armed", async () => {
    const originalListener = vi.fn();
    const vm = {
      blockListener: originalListener,
    };
    const logDrop = vi.fn();
    const readDropDecision = vi.fn(() => ({
      kind: "delete" as const,
      logDrop,
    }));

    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };

    installBlocklyVmEventPipeline(
      vm,
      () => baseContext,
      () => ({getAllBlocks: () => []}),
      () => ({
        blocks: {
          getScripts: () => [],
          _blocks: {},
        },
      }),
      {readDropDecision},
    );

    vm.blockListener({type: "delete", blockId: "x"});
    await new Promise<void>(resolve => {
      queueMicrotask(() => {
        requestAnimationFrame(() => resolve());
      });
    });
    expect(readDropDecision).toHaveBeenCalled();
    expect(logDrop).toHaveBeenCalled();
    expect(originalListener).not.toHaveBeenCalled();
    expect(getBlocklyEventLog()[0]?.type).toBe("delete");

    uninstallBlocklyVmEventPipeline(vm);
    globalThis.requestAnimationFrame = raf;
  });

  it("rebinds workspace listener to the wrapped vm.blockListener", () => {
    const originalListener = vi.fn();
    const vm = {blockListener: originalListener};
    const workspaceListeners: Array<(event: BlocklyEventLike) => void> = [];
    const workspace = {
      addChangeListener(listener: (event: BlocklyEventLike) => void) {
        workspaceListeners.push(listener);
      },
      removeChangeListener(listener: (event: BlocklyEventLike) => void) {
        const index = workspaceListeners.indexOf(listener);
        if (index >= 0) workspaceListeners.splice(index, 1);
      },
    };

    workspace.addChangeListener(originalListener);
    installBlocklyVmEventPipeline(
      vm,
      () => baseContext,
      () => ({getAllBlocks: () => []}),
      () => ({blocks: {getScripts: () => [], _blocks: {}}}),
    );
    rebindWorkspaceBlockListener(workspace);

    expect(workspaceListeners.at(-1)).toBe(vm.blockListener);
    vm.blockListener({type: "delete", blockId: "x"});
    expect(getBlocklyEventLog()[0]?.type).toBe("delete");
    uninstallBlocklyVmEventPipeline(vm);
  });
});
