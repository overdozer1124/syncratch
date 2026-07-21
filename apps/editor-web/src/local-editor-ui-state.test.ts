import {describe, expect, it, vi} from "vitest";
import {
  ACTIVATE_TAB_TYPE,
  BLOCKS_DEFAULT_SCALE,
  BLOCKS_TAB_INDEX,
  COSTUMES_TAB_INDEX,
  DEFAULT_WORKSPACE_VIEWPORT,
  SOUNDS_TAB_INDEX,
  UPDATE_METRICS_TYPE,
  activateTabAction,
  captureLocalEditorUiState,
  chooseWorkspaceViewport,
  readActiveTabIndex,
  readWorkspaceViewport,
  restoreLocalEditorUiState,
  seedViewportForRuntimeTarget,
  updateMetricsAction,
  viewportForTargetSelection,
} from "./local-editor-ui-state.js";

function storeWith(gui: unknown) {
  return {
    getState: () => ({scratchGui: gui}),
    dispatch: vi.fn(),
  };
}

describe("local editor UI state", () => {
  it("reads active tab and viewport from the Scratch GUI store", () => {
    const store = storeWith({
      editorTab: {activeTabIndex: COSTUMES_TAB_INDEX},
      workspaceMetrics: {
        targets: {
          "rt-b": {scrollX: 40, scrollY: -12, scale: 0.9},
        },
      },
    });
    expect(readActiveTabIndex(store)).toBe(COSTUMES_TAB_INDEX);
    expect(readWorkspaceViewport(store, "rt-b")).toEqual({
      scrollX: 40,
      scrollY: -12,
      scale: 0.9,
    });
    expect(readWorkspaceViewport(store, "missing")).toBeNull();
  });

  it("on blocks tab prefers Redux including intentional defaults", () => {
    expect(
      chooseWorkspaceViewport(
        {scrollX: 0, scrollY: 0, scale: BLOCKS_DEFAULT_SCALE},
        {scrollX: 48, scrollY: -36, scale: 1.1},
        {blocksTabActive: true},
      ),
    ).toEqual({scrollX: 0, scrollY: 0, scale: BLOCKS_DEFAULT_SCALE});
  });

  it("on blocks tab falls back to memory when Redux has no entry yet", () => {
    expect(
      chooseWorkspaceViewport(
        null,
        {scrollX: 0, scrollY: 0, scale: BLOCKS_DEFAULT_SCALE},
        {blocksTabActive: true},
      ),
    ).toEqual({scrollX: 0, scrollY: 0, scale: BLOCKS_DEFAULT_SCALE});
  });

  it("uses Scratch defaults when switching to a target with no memory", () => {
    expect(viewportForTargetSelection(null)).toEqual(DEFAULT_WORKSPACE_VIEWPORT);
    expect(
      viewportForTargetSelection({scrollX: 48, scrollY: -36, scale: 1.1}),
    ).toEqual({scrollX: 48, scrollY: -36, scale: 1.1});
  });

  it("off blocks tab prefers per-target memory over unreliable Redux metrics", () => {
    expect(
      chooseWorkspaceViewport(
        {scrollX: 0, scrollY: 0, scale: BLOCKS_DEFAULT_SCALE},
        {scrollX: 48, scrollY: -36, scale: 1.1},
        {blocksTabActive: false},
      ),
    ).toEqual({scrollX: 48, scrollY: -36, scale: 1.1});
    expect(
      chooseWorkspaceViewport(
        {scrollX: -138.5, scrollY: 0, scale: BLOCKS_DEFAULT_SCALE},
        {scrollX: 48, scrollY: -36, scale: 1.1},
        {blocksTabActive: false},
      ),
    ).toEqual({scrollX: 48, scrollY: -36, scale: 1.1});
    expect(
      chooseWorkspaceViewport(
        {scrollX: 12, scrollY: 4, scale: 1},
        null,
        {blocksTabActive: false},
      ),
    ).toEqual({scrollX: 12, scrollY: 4, scale: 1});
  });

  it("captures costumes-tab UI with remembered viewport fallback", () => {
    const store = storeWith({
      editorTab: {activeTabIndex: COSTUMES_TAB_INDEX},
      workspaceMetrics: {
        targets: {
          "rt-old": {scrollX: 0, scrollY: 0, scale: BLOCKS_DEFAULT_SCALE},
        },
      },
    });
    expect(
      captureLocalEditorUiState(
        store,
        "rt-old",
        "looks",
        {scrollX: 1, scrollY: 2, scale: 0.9},
      ),
    ).toEqual({
      activeTabIndex: COSTUMES_TAB_INDEX,
      viewport: {scrollX: 1, scrollY: 2, scale: 0.9},
      toolboxCategoryId: "looks",
    });
  });

  it("restores tab/viewport/toolbox, or viewport-only when asked", () => {
    const store = storeWith({
      editorTab: {activeTabIndex: BLOCKS_TAB_INDEX},
      workspaceMetrics: {targets: {}},
    });
    const restoreToolbox = vi.fn(() => true);
    restoreLocalEditorUiState(
      store,
      {
        activeTabIndex: COSTUMES_TAB_INDEX,
        viewport: {scrollX: 10, scrollY: 20, scale: 1},
        toolboxCategoryId: "control",
      },
      {newRuntimeTargetId: "rt-new", restoreToolboxCategory: restoreToolbox},
    );
    expect(store.dispatch).toHaveBeenCalledWith(
      activateTabAction(COSTUMES_TAB_INDEX),
    );
    expect(restoreToolbox).toHaveBeenCalledWith("control");

    store.dispatch.mockClear();
    restoreToolbox.mockClear();
    restoreLocalEditorUiState(
      store,
      {
        activeTabIndex: SOUNDS_TAB_INDEX,
        viewport: {scrollX: 10, scrollY: 20, scale: 1},
        toolboxCategoryId: "control",
      },
      {
        newRuntimeTargetId: "rt-new",
        restoreToolboxCategory: restoreToolbox,
        restoreTabAndToolbox: false,
      },
    );
    expect(store.dispatch).toHaveBeenCalledWith(
      updateMetricsAction("rt-new", {scrollX: 10, scrollY: 20, scale: 1}),
    );
    expect(store.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({type: ACTIVATE_TAB_TYPE}),
    );
    expect(restoreToolbox).not.toHaveBeenCalled();
    expect(UPDATE_METRICS_TYPE).toContain("UPDATE_METRICS");
  });

  it("does not throw when restore helpers fail", () => {
    const store = {
      getState: () => ({scratchGui: {}}),
      dispatch: vi.fn(() => {
        throw new Error("dispatch failed");
      }),
    };
    expect(() =>
      restoreLocalEditorUiState(
        store,
        {
          activeTabIndex: COSTUMES_TAB_INDEX,
          viewport: {scrollX: 0, scrollY: 0, scale: 1},
          toolboxCategoryId: "motion",
        },
        {
          newRuntimeTargetId: "rt",
          restoreToolboxCategory: () => {
            throw new Error("toolbox failed");
          },
        },
      ),
    ).not.toThrow();
    expect(() =>
      seedViewportForRuntimeTarget(store, "rt", {
        scrollX: 1,
        scrollY: 2,
        scale: 3,
      }),
    ).not.toThrow();
  });
});
