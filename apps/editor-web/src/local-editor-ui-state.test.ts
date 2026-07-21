import {describe, expect, it, vi} from "vitest";
import {
  ACTIVATE_TAB_TYPE,
  BLOCKS_DEFAULT_SCALE,
  BLOCKS_TAB_INDEX,
  COSTUMES_TAB_INDEX,
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

  it("captures a local-only snapshot without sharing target ids as document state", () => {
    const store = storeWith({
      editorTab: {activeTabIndex: SOUNDS_TAB_INDEX},
      workspaceMetrics: {
        targets: {"rt-old": {scrollX: 1, scrollY: 2, scale: 0.675}},
      },
    });
    expect(captureLocalEditorUiState(store, "rt-old", "looks")).toEqual({
      activeTabIndex: 2,
      viewport: {scrollX: 1, scrollY: 2, scale: 0.675},
      toolboxCategoryId: "looks",
    });
  });

  it("restores tab and seeds remapped viewport metrics; toolbox is optional", () => {
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
    expect(store.dispatch).toHaveBeenCalledWith(
      updateMetricsAction("rt-new", {scrollX: 10, scrollY: 20, scale: 1}),
    );
    expect(restoreToolbox).toHaveBeenCalledWith("control");
    expect(ACTIVATE_TAB_TYPE).toContain("ACTIVATE_TAB");
    expect(UPDATE_METRICS_TYPE).toContain("UPDATE_METRICS");
  });

  it("keeps a remembered viewport when Redux falls back to Scratch defaults", () => {
    expect(
      chooseWorkspaceViewport(
        {scrollX: 0, scrollY: 0, scale: BLOCKS_DEFAULT_SCALE},
        {scrollX: 48, scrollY: -36, scale: 1.1},
      ),
    ).toEqual({scrollX: 48, scrollY: -36, scale: 1.1});
    expect(
      chooseWorkspaceViewport(
        {scrollX: 12, scrollY: 4, scale: 1},
        {scrollX: 48, scrollY: -36, scale: 1.1},
      ),
    ).toEqual({scrollX: 12, scrollY: 4, scale: 1});
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
