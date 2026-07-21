import {describe, expect, it} from "vitest";
import type {ScratchTarget} from "@blocksync/project-schema";
import {
  blockConnectivityScore,
  isWeakerBlockGraph,
} from "./block-connectivity.js";

function targetWithBlocks(
  blocks: ScratchTarget["blocks"],
): ScratchTarget {
  return {
    id: "s1",
    name: "Sprite1",
    isStage: false,
    blocks,
    comments: {},
    currentCostume: 0,
    costumes: [],
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
  };
}

describe("blockConnectivityScore", () => {
  it("scores a nested forever stack higher than a forever with detached siblings", () => {
    const complete = targetWithBlocks({
      flag: {id: "flag", opcode: "event_whenflagclicked", next: "goto", parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true},
      goto: {id: "goto", opcode: "motion_gotoxy", next: "forever", parent: "flag", inputs: {}, fields: {}, shadow: false, topLevel: false},
      forever: {
        id: "forever",
        opcode: "control_forever",
        next: null,
        parent: "goto",
        inputs: {SUBSTACK: [2, "turn"]},
        fields: {},
        shadow: false,
        topLevel: false,
      },
      turn: {id: "turn", opcode: "motion_turnright", next: "move", parent: "forever", inputs: {}, fields: {}, shadow: false, topLevel: false},
      move: {id: "move", opcode: "motion_movesteps", next: "bounce", parent: "turn", inputs: {}, fields: {}, shadow: false, topLevel: false},
      bounce: {id: "bounce", opcode: "motion_ifonedgebounce", next: "repeat", parent: "move", inputs: {}, fields: {}, shadow: false, topLevel: false},
      repeat: {
        id: "repeat",
        opcode: "control_repeat",
        next: null,
        parent: "bounce",
        inputs: {SUBSTACK: [2, "move2"]},
        fields: {},
        shadow: false,
        topLevel: false,
      },
      move2: {id: "move2", opcode: "motion_movesteps", next: null, parent: "repeat", inputs: {}, fields: {}, shadow: false, topLevel: false},
    });

    const incomplete = targetWithBlocks({
      flag: {id: "flag", opcode: "event_whenflagclicked", next: "goto", parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true},
      goto: {id: "goto", opcode: "motion_gotoxy", next: "forever", parent: "flag", inputs: {}, fields: {}, shadow: false, topLevel: false},
      forever: {
        id: "forever",
        opcode: "control_forever",
        next: null,
        parent: "goto",
        inputs: {SUBSTACK: [2, "turn"]},
        fields: {},
        shadow: false,
        topLevel: false,
      },
      turn: {id: "turn", opcode: "motion_turnright", next: null, parent: "forever", inputs: {}, fields: {}, shadow: false, topLevel: false},
      // Detached stack (mid-drag / LWW snapshot).
      move: {id: "move", opcode: "motion_movesteps", next: "bounce", parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true},
      bounce: {id: "bounce", opcode: "motion_ifonedgebounce", next: "repeat", parent: "move", inputs: {}, fields: {}, shadow: false, topLevel: false},
      repeat: {
        id: "repeat",
        opcode: "control_repeat",
        next: null,
        parent: "bounce",
        inputs: {SUBSTACK: [2, "move2"]},
        fields: {},
        shadow: false,
        topLevel: false,
      },
      move2: {id: "move2", opcode: "motion_movesteps", next: null, parent: "repeat", inputs: {}, fields: {}, shadow: false, topLevel: false},
    });

    expect(blockConnectivityScore(complete)).toBeGreaterThan(
      blockConnectivityScore(incomplete),
    );
    expect(isWeakerBlockGraph(incomplete, complete)).toBe(true);
    expect(isWeakerBlockGraph(complete, incomplete)).toBe(false);
  });

  it("does not treat a smaller block set as a weaker graph", () => {
    const full = targetWithBlocks({
      a: {id: "a", opcode: "motion_movesteps", next: "b", parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true},
      b: {id: "b", opcode: "motion_turnright", next: null, parent: "a", inputs: {}, fields: {}, shadow: false, topLevel: false},
    });
    const trimmed = targetWithBlocks({
      a: {id: "a", opcode: "motion_movesteps", next: null, parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true},
    });
    expect(isWeakerBlockGraph(trimmed, full)).toBe(false);
  });
});
