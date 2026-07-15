import { describe, expect, it } from "vitest";
import {
  CollaborationDocument,
  applyUpdate,
  encodeState,
} from "../src/index.js";
import type { ScratchBlock } from "@blocksync/project-schema";

function stack(sprite: string): Record<string, ScratchBlock> {
  const hat = `${sprite}-hat`;
  const move = `${sprite}-move`;
  return {
    [hat]: {
      id: hat,
      opcode: "event_whenflagclicked",
      next: move,
      parent: null,
      inputs: {},
      fields: {},
      topLevel: true,
    },
    [move]: {
      id: move,
      opcode: "motion_movesteps",
      next: null,
      parent: hat,
      inputs: { STEPS: [1, [4, "10"]] },
      fields: {},
      topLevel: false,
    },
  };
}

describe("CollaborationDocument", () => {
  it("accepts valid sprite updates and syncs via Yjs update", () => {
    const a = new CollaborationDocument();
    const b = new CollaborationDocument();

    const r1 = a.applySpriteBlocks({
      transactionId: "t1",
      spriteId: "spriteA",
      blocks: stack("spriteA"),
    });
    expect(r1.accepted).toBe(true);

    applyUpdate(b, encodeState(a));
    const mat = b.materialize();
    expect(mat.targets.some((t) => t.id === "spriteA")).toBe(true);

    const r2 = b.applySpriteBlocks({
      transactionId: "t2",
      spriteId: "spriteB",
      blocks: stack("spriteB"),
    });
    expect(r2.accepted).toBe(true);
    applyUpdate(a, encodeState(b));

    const finalDoc = a.materialize();
    expect(finalDoc.targets.map((t) => t.id).sort()).toEqual(
      ["spriteA", "spriteB", "stage"].sort(),
    );
  });

  it("rejects structurally invalid ops without committing", () => {
    const doc = new CollaborationDocument();
    const bad: Record<string, ScratchBlock> = {
      a: {
        id: "a",
        opcode: "motion_movesteps",
        next: "b",
        parent: null,
        inputs: {},
        fields: {},
        topLevel: true,
      },
      b: {
        id: "b",
        opcode: "motion_movesteps",
        next: null,
        parent: null,
        inputs: {},
        fields: {},
        topLevel: false,
      },
    };
    const r = doc.applySpriteBlocks({
      transactionId: "bad",
      spriteId: "spriteA",
      blocks: bad,
    });
    expect(r.accepted).toBe(false);
    expect(doc.materialize().targets.some((t) => t.id === "spriteA" && Object.keys(t.blocks).length > 0)).toBe(false);
  });

  it("is idempotent on transactionId", () => {
    const doc = new CollaborationDocument();
    const blocks = stack("spriteA");
    const r1 = doc.applySpriteBlocks({
      transactionId: "same",
      spriteId: "spriteA",
      blocks,
    });
    const r2 = doc.applySpriteBlocks({
      transactionId: "same",
      spriteId: "spriteA",
      blocks,
    });
    expect(r1.accepted && r2.accepted && r2.duplicate).toBe(true);
  });
});
