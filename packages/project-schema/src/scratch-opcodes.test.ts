import { describe, expect, it } from "vitest";
import { allowedOpcodeSet, CORPUS_OPCODES } from "./scratch-opcodes.js";
import {
  validateProject,
  type CostumeRef,
  type ProjectDocument,
  type ScratchTarget,
} from "./index.js";

function minimalCostume(
  assetId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
): CostumeRef {
  return {
    kind: "costume",
    name: "c1",
    assetId,
    md5ext: `${assetId}.svg`,
    dataFormat: "svg",
    contentSha256: "b".repeat(64),
    rotationCenterX: 0,
    rotationCenterY: 0,
  };
}

function v2Stage(overrides: Partial<ScratchTarget> = {}): ScratchTarget {
  return {
    id: "stage",
    name: "Stage",
    isStage: true,
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [minimalCostume("cccccccccccccccccccccccccccccccc")],
    sounds: [],
    volume: 100,
    layerOrder: 0,
    tempo: 60,
    videoTransparency: 50,
    videoState: "on",
    textToSpeechLanguage: null,
    ...overrides,
  };
}

function v2Sprite(overrides: Partial<ScratchTarget> = {}): ScratchTarget {
  return {
    id: "s1",
    name: "Sprite1",
    isStage: false,
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [minimalCostume()],
    sounds: [],
    volume: 100,
    layerOrder: 1,
    visible: true,
    x: 0,
    y: 0,
    size: 100,
    direction: 90,
    draggable: false,
    rotationStyle: "all around",
    ...overrides,
  };
}

describe("Scratch opcode allow-list (§6.6)", () => {
  it("includes corpus opcodes from §6.6.3", () => {
    const allowed = allowedOpcodeSet();
    for (const opcode of CORPUS_OPCODES) {
      expect(allowed.has(opcode)).toBe(true);
    }
  });

  it("rejects motion_unknown (no prefix matching)", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [
        v2Sprite({
          blocks: {
            b: {
              id: "b",
              opcode: "motion_unknown",
              next: null,
              parent: null,
              inputs: {},
              fields: {},
              topLevel: true,
            },
          },
        }),
      ],
    };
    const result = validateProject(doc);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "UNKNOWN_OPCODE")).toBe(true);
  });

  it("rejects duplicate sprite names", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [
        v2Stage(),
        v2Sprite({ id: "s1", name: "Twin" }),
        v2Sprite({ id: "s2", name: "Twin", layerOrder: 2 }),
      ],
    };
    expect(
      validateProject(doc).issues.some((i) => i.code === "DUPLICATE_SPRITE_NAME"),
    ).toBe(true);
  });

  it("rejects non-empty monitors", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [{ id: "m1" }],
      targets: [v2Stage()],
    };
    expect(
      validateProject(doc).issues.some((i) => i.code === "INVALID_MONITORS"),
    ).toBe(true);
  });

  it("rejects non-empty target comments", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [v2Stage({ comments: { c1: { text: "nope" } } })],
    };
    expect(
      validateProject(doc).issues.some((i) => i.code === "INVALID_COMMENTS"),
    ).toBe(true);
  });

  it("rejects block comment field", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [
        v2Sprite({
          blocks: {
            b: {
              id: "b",
              opcode: "event_whenflagclicked",
              next: null,
              parent: null,
              inputs: {},
              fields: {},
              topLevel: true,
              comment: "block-comment-id",
            },
          },
        }),
      ],
    };
    expect(
      validateProject(doc).issues.some((i) => i.code === "DISALLOWED_BLOCK_FIELD"),
    ).toBe(true);
  });
});
