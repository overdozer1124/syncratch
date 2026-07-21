import {describe, expect, it, vi} from "vitest";
import type {ProjectDocument, ScratchTarget} from "@blocksync/project-schema";
import {
  captureEditingSelection,
  loadProjectPreservingEditingTarget,
  resolveRuntimeEditingTargetId,
} from "./load-project-preserving-editing-target.js";

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
        // Scratch regenerates ids and forces the first sprite.
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
});
