import {describe, expect, it} from "vitest";
import {
  applyViewportToScratchWorkspace,
  isInternalMetricsEcho,
  readWorkspaceViewportFromScratch,
  resolveScratchWorkspace,
} from "./scratch-workspace.js";

describe("scratch workspace access", () => {
  it("resolves getMainWorkspace before React fiber walks", () => {
    const workspace = {scrollX: 1, scrollY: 2, scale: 0.9};
    expect(
      resolveScratchWorkspace(null, {
        getMainWorkspace: () => workspace,
      }),
    ).toBe(workspace);
  });

  it("walks React fibers from the injection host when Blockly is a stub", () => {
    const workspace = {scrollX: 4, scrollY: -5, scale: 1.1};
    const injection = {
      className: "injectionDiv",
      __reactFiber$test: {
        stateNode: {workspace},
        return: null,
      },
    };
    const root = {
      querySelector(selector: string) {
        return selector.includes("injectionDiv") ? injection : null;
      },
    };
    expect(
      resolveScratchWorkspace(
        root as unknown as ParentNode,
        {getMainWorkspace: () => null},
      ),
    ).toBe(workspace);
  });

  it("reads and applies viewport metrics on a workspace handle", () => {
    const workspace = {
      scrollX: 0,
      scrollY: 0,
      scale: 0.675,
      resize: () => undefined,
    };
    expect(readWorkspaceViewportFromScratch(workspace)).toEqual({
      scrollX: 0,
      scrollY: 0,
      scale: 0.675,
    });
    expect(
      applyViewportToScratchWorkspace(workspace, {
        scrollX: 10,
        scrollY: -20,
        scale: 1.2,
      }),
    ).toBe(true);
    expect(workspace).toMatchObject({scrollX: 10, scrollY: -20, scale: 1.2});
  });

  it("matches only same-epoch internal metric echoes", () => {
    const pending = {
      epoch: 3,
      targetId: "rt-1",
      viewport: {scrollX: 0, scrollY: 0, scale: 0.675},
    };
    expect(
      isInternalMetricsEcho(pending, {
        epoch: 3,
        targetId: "rt-1",
        viewport: {scrollX: 0, scrollY: 0, scale: 0.675},
      }),
    ).toBe(true);
    expect(
      isInternalMetricsEcho(pending, {
        epoch: 3,
        targetId: "rt-1",
        viewport: {scrollX: 48, scrollY: -36, scale: 1.1},
      }),
    ).toBe(false);
    expect(
      isInternalMetricsEcho(pending, {
        epoch: 4,
        targetId: "rt-1",
        viewport: {scrollX: 0, scrollY: 0, scale: 0.675},
      }),
    ).toBe(false);
  });
});
