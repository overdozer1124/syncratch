import {describe, expect, it} from "vitest";
import type {ProjectDocument, ScratchTarget} from "@blocksync/project-schema";
import {preserveTargetIds} from "./target-identity.js";

const target = (
  id: string,
  name: string,
  isStage: boolean,
  layerOrder: number,
): ScratchTarget => ({
  id,
  name,
  isStage,
  layerOrder,
  blocks: {},
  variables: {},
  lists: {},
  broadcasts: {},
});

describe("preserveTargetIds", () => {
  it("keeps stage and sprite ids when their names change", () => {
    const previous: ProjectDocument = {
      schemaVersion: 2,
      targets: [
        target("stage-id", "Stage", true, 0),
        target("sprite-id", "Sprite1", false, 1),
      ],
    };
    const converted: ProjectDocument = {
      schemaVersion: 2,
      targets: [
        target("name-derived-stage", "Stage A", true, 0),
        target("name-derived-sprite", "Sprite B", false, 1),
      ],
    };

    expect(
      preserveTargetIds(previous, converted).targets.map(({id, name}) => ({
        id,
        name,
      })),
    ).toEqual([
      {id: "stage-id", name: "Stage A"},
      {id: "sprite-id", name: "Sprite B"},
    ]);
  });

  it("matches multiple sprites by stable layer order", () => {
    const previous: ProjectDocument = {
      schemaVersion: 2,
      targets: [
        target("sprite-a", "A", false, 1),
        target("sprite-b", "B", false, 2),
      ],
    };
    const converted: ProjectDocument = {
      schemaVersion: 2,
      targets: [
        target("derived-b", "Renamed B", false, 2),
        target("derived-a", "Renamed A", false, 1),
      ],
    };

    expect(
      preserveTargetIds(previous, converted).targets.map(({id, layerOrder}) => ({
        id,
        layerOrder,
      })),
    ).toEqual([
      {id: "sprite-b", layerOrder: 2},
      {id: "sprite-a", layerOrder: 1},
    ]);
  });
});
