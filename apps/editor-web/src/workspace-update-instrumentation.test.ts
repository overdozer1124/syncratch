import {beforeEach, describe, expect, it, vi} from "vitest";
import {
  clearWorkspaceUpdateInstrumentation,
  getLoadBoundaryLog,
  getSuppressedDirtyLog,
  getWorkspaceUpdateLog,
  installWorkspaceUpdateListener,
  recordLoadBoundaryTransition,
  recordSuppressedProjectChanged,
  recordWorkspaceUpdateSettled,
  recordWorkspaceUpdateStart,
} from "./workspace-update-instrumentation.js";

const baseContext = {
  loadEpoch: 0,
  suppressVmChanges: false,
  diagnosticReady: true,
  uiRestoreEpoch: 1,
  collaborationGeneration: 2,
  projectSessionId: 3,
  saveDirtyGeneration: 4,
  editingTarget: {
    id: "t1",
    getName: () => "Sprite1",
    blocks: {
      getScripts: () => ["hat"],
      _blocks: {
        hat: {parent: null, next: "body", inputs: {}},
        body: {parent: "hat", next: null, inputs: {}},
      },
    },
  },
};

describe("workspace-update-instrumentation", () => {
  beforeEach(() => {
    clearWorkspaceUpdateInstrumentation();
  });

  it("records load boundary transitions with monotonic loadEpoch", () => {
    recordLoadBoundaryTransition("load", true, baseContext);
    recordLoadBoundaryTransition("load", false, baseContext);
    const log = getLoadBoundaryLog();
    expect(log).toHaveLength(2);
    expect(log[0]?.suppressed).toBe(true);
    expect(log[0]?.loadEpoch).toBe(1);
    expect(log[1]?.suppressed).toBe(false);
    expect(log[1]?.loadEpoch).toBe(1);
  });

  it("detects partial failure when Blockly is empty but VM scripts remain", () => {
    const start = recordWorkspaceUpdateStart(baseContext, 128);
    const settled = recordWorkspaceUpdateSettled(
      start.seq,
      baseContext,
      {getTopBlocks: () => [], getAllBlocks: () => []},
    );
    expect(settled?.partialFailureLikely).toBe(true);
    expect(settled?.phase).toBe("settled");
    expect(settled?.saveDirtyGeneration).toBe(4);
  });

  it("deduplicates suppressed PROJECT_CHANGED records", () => {
    recordSuppressedProjectChanged(baseContext);
    recordSuppressedProjectChanged(baseContext);
    expect(getSuppressedDirtyLog()).toHaveLength(1);
    expect(getSuppressedDirtyLog()[0]?.repeatCount).toBe(2);
  });

  it("installWorkspaceUpdateListener observes without altering emit order", async () => {
    const raf = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    };
    try {
      const handlers = new Map<string, Set<(data: {xml?: string}) => void>>();
      const vm = {
        on(event: "workspaceUpdate", handler: (data: {xml?: string}) => void) {
          if (!handlers.has(event)) handlers.set(event, new Set());
          handlers.get(event)!.add(handler);
        },
      };
      const readWorkspace = vi.fn(() => ({
        getTopBlocks: () => [],
        getAllBlocks: () => [],
      }));

      installWorkspaceUpdateListener(vm, () => baseContext, readWorkspace);
      for (const handler of handlers.get("workspaceUpdate") ?? []) {
        handler({xml: "<xml/>"});
      }

      expect(getWorkspaceUpdateLog()).toHaveLength(1);
      expect(getWorkspaceUpdateLog()[0]?.phase).toBe("start");

      await new Promise<void>(resolve => {
        queueMicrotask(() => resolve());
      });

      expect(readWorkspace).toHaveBeenCalledTimes(1);
      expect(getWorkspaceUpdateLog().some(entry => entry.phase === "settled")).toBe(
        true,
      );
    } finally {
      globalThis.requestAnimationFrame = raf;
    }
  });
});
