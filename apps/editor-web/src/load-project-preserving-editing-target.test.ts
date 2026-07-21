import {describe, expect, it, vi} from "vitest";
import type {ProjectDocument, ScratchTarget} from "@blocksync/project-schema";
import {
  captureEditingSelection,
  loadProjectPreservingEditingTarget,
  resolveRuntimeEditingTargetId,
} from "./load-project-preserving-editing-target.js";
import {ACTIVATE_TAB_TYPE, COSTUMES_TAB_INDEX} from "./local-editor-ui-state.js";

function sprite(id: string, name: string, layerOrder: number): ScratchTarget {
  return {
    id,
    name,
    isStage: false,
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [],
    sounds: [],
    volume: 100,
    layerOrder,
    visible: true,
    x: 0,
    y: 0,
    size: 100,
    direction: 90,
    draggable: false,
    rotationStyle: "all around",
  };
}

function stage(): ScratchTarget {
  return {
    id: "stage",
    name: "Stage",
    isStage: true,
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [],
    sounds: [],
    volume: 100,
    layerOrder: 0,
    tempo: 60,
    videoTransparency: 50,
    videoState: "on",
    textToSpeechLanguage: null,
  };
}

function documentOf(targets: ScratchTarget[]): ProjectDocument {
  return {schemaVersion: 2, targets, extensions: [], monitors: [], meta: {}};
}

describe("editing selection remapping", () => {
  it("captures a stable document id from the selected sprite name", () => {
    const doc = documentOf([stage(), sprite("id-a", "Sprite1", 1), sprite("id-b", "Sprite2", 2)]);
    const selection = captureEditingSelection(
      {id: "runtime-old-b", isStage: false, getName: () => "Sprite2"},
      doc,
    );
    expect(selection).toEqual({
      documentId: "id-b",
      isStage: false,
      name: "Sprite2",
    });
  });

  it("resolves a new runtime id after loadProject regenerates ids", () => {
    const after = documentOf([
      stage(),
      sprite("id-a", "Sprite1", 1),
      sprite("id-b", "Sprite2", 2),
    ]);
    const runtimeId = resolveRuntimeEditingTargetId(
      [
        {id: "rt-stage", isStage: true, getName: () => "Stage", isOriginal: true},
        {id: "rt-a-new", isStage: false, getName: () => "Sprite1", isOriginal: true},
        {id: "rt-b-new", isStage: false, getName: () => "Sprite2", isOriginal: true},
      ],
      {documentId: "id-b", isStage: false, name: "Sprite2"},
      after,
    );
    expect(runtimeId).toBe("rt-b-new");
  });

  it("follows a rename when the collaboration document id is unchanged", () => {
    const after = documentOf([
      stage(),
      sprite("id-a", "Sprite1", 1),
      sprite("id-b", "Renamed", 2),
    ]);
    const runtimeId = resolveRuntimeEditingTargetId(
      [
        {id: "rt-stage", isStage: true, getName: () => "Stage", isOriginal: true},
        {id: "rt-a-new", isStage: false, getName: () => "Sprite1", isOriginal: true},
        {id: "rt-b-new", isStage: false, getName: () => "Renamed", isOriginal: true},
      ],
      {documentId: "id-b", isStage: false, name: "Sprite2"},
      after,
    );
    expect(runtimeId).toBe("rt-b-new");
  });

  it("returns null when the selected sprite was deleted remotely", () => {
    const after = documentOf([stage(), sprite("id-a", "Sprite1", 1)]);
    const runtimeId = resolveRuntimeEditingTargetId(
      [
        {id: "rt-stage", isStage: true, getName: () => "Stage", isOriginal: true},
        {id: "rt-a-new", isStage: false, getName: () => "Sprite1", isOriginal: true},
      ],
      {documentId: "id-b", isStage: false, name: "Sprite2"},
      after,
    );
    expect(runtimeId).toBeNull();
  });

  it("restores selection after load even when runtime ids change", async () => {
    const before = documentOf([
      stage(),
      sprite("id-a", "Sprite1", 1),
      sprite("id-b", "Sprite2", 2),
    ]);
    const after = before;
    const setEditingTarget = vi.fn();
    const vm = {
      editingTarget: {
        id: "runtime-old-b",
        isStage: false,
        getName: () => "Sprite2",
      },
      setEditingTarget,
      runtime: {
        targets: [
          {id: "runtime-old-stage", isStage: true, getName: () => "Stage", isOriginal: true},
          {id: "runtime-old-a", isStage: false, getName: () => "Sprite1", isOriginal: true},
          {id: "runtime-old-b", isStage: false, getName: () => "Sprite2", isOriginal: true},
        ],
      },
      loadProject: vi.fn(async () => {
        vm.editingTarget = {
          id: "runtime-new-a",
          isStage: false,
          getName: () => "Sprite1",
        };
        vm.runtime.targets = [
          {id: "runtime-new-stage", isStage: true, getName: () => "Stage", isOriginal: true},
          {id: "runtime-new-a", isStage: false, getName: () => "Sprite1", isOriginal: true},
          {id: "runtime-new-b", isStage: false, getName: () => "Sprite2", isOriginal: true},
        ];
      }),
    };

    await loadProjectPreservingEditingTarget(vm, {targets: []}, {
      beforeDocument: before,
      afterDocument: after,
    });

    expect(setEditingTarget).toHaveBeenCalledWith("runtime-new-b");
  });

  it("seeds remapped viewport metrics before restoring the editing target", async () => {
    const before = documentOf([
      stage(),
      sprite("id-a", "Sprite1", 1),
      sprite("id-b", "Sprite2", 2),
    ]);
    const after = before;
    const setEditingTarget = vi.fn();
    const dispatch = vi.fn();
    const restoreToolbox = vi.fn(() => true);
    const remember = vi.fn();
    const scheduled: Array<() => void> = [];
    let currentRuntimeId: string | null = "runtime-new-b";
    let epoch = 0;
    const vm = {
      editingTarget: {
        id: "runtime-old-b",
        isStage: false,
        getName: () => "Sprite2",
      },
      setEditingTarget: (id: string) => {
        setEditingTarget(id);
        currentRuntimeId = id;
        vm.editingTarget = {
          id,
          isStage: false,
          getName: () => (id.endsWith("b") ? "Sprite2" : "Sprite1"),
        };
      },
      runtime: {
        targets: [
          {id: "runtime-old-b", isStage: false, getName: () => "Sprite2", isOriginal: true},
        ],
      },
      loadProject: vi.fn(async () => {
        vm.runtime.targets = [
          {id: "runtime-new-a", isStage: false, getName: () => "Sprite1", isOriginal: true},
          {id: "runtime-new-b", isStage: false, getName: () => "Sprite2", isOriginal: true},
        ];
      }),
    };
    const guiStore = {
      getState: () => ({
        scratchGui: {
          editorTab: {activeTabIndex: COSTUMES_TAB_INDEX},
          workspaceMetrics: {
            targets: {
              "runtime-old-b": {scrollX: 0, scrollY: 0, scale: 0.675},
            },
          },
        },
      }),
      dispatch,
    };

    await loadProjectPreservingEditingTarget(vm, {targets: []}, {
      beforeDocument: before,
      afterDocument: after,
      localUi: {
        store: guiStore,
        readToolboxCategoryId: () => "looks",
        restoreToolboxCategory: restoreToolbox,
        rememberedViewportForSelection: () => ({
          scrollX: 33,
          scrollY: -8,
          scale: 1.25,
        }),
        rememberViewportForSelection: remember,
        beginRestoreEpoch: () => {
          epoch += 1;
          return epoch;
        },
        isRestoreEpochCurrent: value => value === epoch,
        currentRuntimeEditingTargetId: () => currentRuntimeId,
        scheduleViewportSettle: work => {
          scheduled.push(work);
        },
      },
    });

    expect(setEditingTarget).toHaveBeenCalledWith("runtime-new-b");
    expect(remember).toHaveBeenCalledWith(
      expect.objectContaining({documentId: "id-b"}),
      {scrollX: 33, scrollY: -8, scale: 1.25},
    );
    const metricCalls = dispatch.mock.calls
      .map(call => call[0] as {type?: string; targetID?: string; scrollX?: number})
      .filter(action => action.type?.includes("UPDATE_METRICS"));
    expect(metricCalls[0]).toMatchObject({
      targetID: "runtime-new-b",
      scrollX: 33,
    });
    expect(restoreToolbox).toHaveBeenCalledWith("looks");
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: expect.stringContaining("ACTIVATE_TAB"),
        activeTabIndex: COSTUMES_TAB_INDEX,
      }),
    );

    // Deferred settle: viewport only; tab must not be redispatched after user moves.
    dispatch.mockClear();
    restoreToolbox.mockClear();
    currentRuntimeId = "runtime-new-a";
    vm.setEditingTarget("runtime-new-a");
    setEditingTarget.mockClear();
    scheduled[0]!();
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({type: ACTIVATE_TAB_TYPE}),
    );
    expect(restoreToolbox).not.toHaveBeenCalled();
  });

  it("ignores deferred viewport settle after a newer restore epoch", async () => {
    const before = documentOf([
      stage(),
      sprite("id-a", "Sprite1", 1),
      sprite("id-b", "Sprite2", 2),
    ]);
    const after = before;
    const dispatch = vi.fn();
    const applyViewport = vi.fn();
    const scheduled: Array<() => void> = [];
    let epoch = 0;
    const vm = {
      editingTarget: {
        id: "runtime-old-b",
        isStage: false,
        getName: () => "Sprite2",
      },
      setEditingTarget: vi.fn(),
      runtime: {
        targets: [
          {id: "runtime-old-b", isStage: false, getName: () => "Sprite2", isOriginal: true},
        ],
      },
      loadProject: vi.fn(async () => {
        vm.runtime.targets = [
          {id: "runtime-new-b", isStage: false, getName: () => "Sprite2", isOriginal: true},
        ];
      }),
    };

    await loadProjectPreservingEditingTarget(vm, {targets: []}, {
      beforeDocument: before,
      afterDocument: after,
      localUi: {
        store: {
          getState: () => ({
            scratchGui: {
              editorTab: {activeTabIndex: 0},
              workspaceMetrics: {
                targets: {
                  "runtime-old-b": {scrollX: 48, scrollY: -36, scale: 1.1},
                },
              },
            },
          }),
          dispatch,
        },
        rememberedViewportForSelection: () => null,
        beginRestoreEpoch: () => ++epoch,
        isRestoreEpochCurrent: value => value === epoch,
        currentRuntimeEditingTargetId: () => "runtime-new-b",
        applyViewport,
        scheduleViewportSettle: work => {
          scheduled.push(work);
        },
      },
    });

    epoch += 1; // simulate a later apply / session replacement
    dispatch.mockClear();
    scheduled[0]!();
    expect(applyViewport).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });
});
