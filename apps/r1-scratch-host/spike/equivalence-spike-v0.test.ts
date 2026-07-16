import { describe, expect, it } from "vitest";
import type { ScratchBlockSpikeV0 } from "./schema/document-spike-v0.js";
import {
  EquivalenceGraphError,
  scriptFingerprint,
  scriptRootFingerprints,
  stableJson,
} from "./block-graph-canonical.js";
import { equivalenceSpikeV0, buildExpectedCustomProcedureDocument } from "./equivalence-spike-v0.js";
import type { DocumentSpikeV0 } from "./schema/document-spike-v0.js";

function renameBlockGraph(
  blocks: Record<string, ScratchBlockSpikeV0>,
  idMap: Record<string, string>,
): Record<string, ScratchBlockSpikeV0> {
  const remapRef = (value: unknown): unknown => {
    if (typeof value === "string" && idMap[value]) return idMap[value];
    if (Array.isArray(value)) return value.map(remapRef);
    return value;
  };

  const out: Record<string, ScratchBlockSpikeV0> = {};
  for (const [oldId, b] of Object.entries(blocks)) {
    const newId = idMap[oldId] ?? oldId;
    const inputs: Record<string, unknown> = {};
    for (const [slot, inp] of Object.entries(b.inputs ?? {})) {
      inputs[slot] = remapRef(inp);
    }
    out[newId] = {
      ...b,
      next: b.next ? (idMap[b.next] ?? b.next) : null,
      parent: b.parent ? (idMap[b.parent] ?? b.parent) : null,
      inputs,
    };
  }
  return out;
}

function substackRepeatChainBlocks(): Record<string, ScratchBlockSpikeV0> {
  return {
    hat: {
      opcode: "event_whenflagclicked",
      next: null,
      parent: null,
      inputs: { SUBSTACK: [2, "rep"] },
      fields: {},
      topLevel: true,
      x: 0,
      y: 0,
    },
    rep: {
      opcode: "control_repeat",
      next: null,
      parent: "hat",
      inputs: {
        TIMES: [1, [6, "10"]],
        SUBSTACK: [2, "move"],
      },
      fields: {},
      topLevel: false,
    },
    move: {
      opcode: "motion_movesteps",
      next: "say",
      parent: "rep",
      inputs: { STEPS: [1, [4, "5"]] },
      fields: {},
      topLevel: false,
    },
    say: {
      opcode: "looks_say",
      next: null,
      parent: "rep",
      inputs: { MESSAGE: [1, [10, "hi"]] },
      fields: {},
      topLevel: false,
    },
  };
}

function docWithBlocks(blocks: Record<string, ScratchBlockSpikeV0>): DocumentSpikeV0 {
  return {
    schemaVersion: 0,
    extensions: [],
    targets: [
      {
        name: "Stage",
        isStage: true,
        blocks: {},
        variables: {},
        lists: {},
        broadcasts: {},
        currentCostume: 0,
        costumes: [],
        sounds: [],
        volume: 100,
        layerOrder: 0,
        tempo: 60,
        videoTransparency: 50,
        videoState: "on",
        textToSpeechLanguage: null,
      },
      {
        name: "Sprite1",
        isStage: false,
        blocks,
        variables: {},
        lists: {},
        broadcasts: {},
        currentCostume: 0,
        costumes: [],
        sounds: [],
        volume: 100,
        layerOrder: 0,
        visible: true,
        x: 0,
        y: 0,
        size: 100,
        direction: 90,
        draggable: false,
        rotationStyle: "all around",
      },
    ],
  };
}

describe("equivalenceSpikeV0 block graph canonicalization", () => {
  it("treats UID-regenerated graphs as equivalent", () => {
    const base = buildExpectedCustomProcedureDocument();
    const sprite = base.targets.find((t) => !t.isStage)!;
    const renamed = renameBlockGraph(sprite.blocks, {
      define_id: "def2",
      proto_id: "pr2",
      attached_id: "at2",
    });

    const docA: DocumentSpikeV0 = structuredClone(base);
    const docB: DocumentSpikeV0 = structuredClone(base);
    docB.targets.find((t) => !t.isStage)!.blocks = renamed;

    expect(equivalenceSpikeV0(docA, docB)).toBe(true);
  });

  it("treats object key order changes as equivalent", () => {
    const base = buildExpectedCustomProcedureDocument();
    const sprite = base.targets.find((t) => !t.isStage)!;
    const reordered: Record<string, ScratchBlockSpikeV0> = {};
    for (const id of Object.keys(sprite.blocks).reverse()) {
      reordered[id] = sprite.blocks[id];
    }

    const docA: DocumentSpikeV0 = structuredClone(base);
    const docB: DocumentSpikeV0 = structuredClone(base);
    docB.targets.find((t) => !t.isStage)!.blocks = reordered;

    expect(equivalenceSpikeV0(docA, docB)).toBe(true);
  });

  it("preserves multiset counts for duplicate top-level stacks", () => {
    const blocks: Record<string, ScratchBlockSpikeV0> = {
      a1: {
        opcode: "event_whenflagclicked",
        next: "m1",
        parent: null,
        inputs: {},
        fields: {},
        topLevel: true,
        x: 0,
        y: 0,
      },
      m1: {
        opcode: "motion_movesteps",
        next: null,
        parent: "a1",
        inputs: { STEPS: [1, [4, "1"]] },
        fields: {},
        topLevel: false,
      },
      a2: {
        opcode: "event_whenflagclicked",
        next: "m2",
        parent: null,
        inputs: {},
        fields: {},
        topLevel: true,
        x: 0,
        y: 0,
      },
      m2: {
        opcode: "motion_movesteps",
        next: null,
        parent: "a2",
        inputs: { STEPS: [1, [4, "1"]] },
        fields: {},
        topLevel: false,
      },
    };

    expect(scriptRootFingerprints(blocks)).toEqual([
      scriptFingerprint(blocks, "a1"),
      scriptFingerprint(blocks, "a2"),
    ]);
  });

  it("returns false when opcode changes", () => {
    const base = buildExpectedCustomProcedureDocument();
    const changed: DocumentSpikeV0 = structuredClone(base);
    const sprite = changed.targets.find((t) => !t.isStage)!;
    sprite.blocks.attached_id.opcode = "motion_gotoxy";

    expect(equivalenceSpikeV0(base, changed)).toBe(false);
  });

  it("returns false when primitive input changes", () => {
    const base = buildExpectedCustomProcedureDocument();
    const changed: DocumentSpikeV0 = structuredClone(base);
    const sprite = changed.targets.find((t) => !t.isStage)!;
    sprite.blocks.attached_id.inputs = { STEPS: [1, [4, "99"]] };

    expect(equivalenceSpikeV0(base, changed)).toBe(false);
  });

  it("returns false when mutation changes", () => {
    const base = buildExpectedCustomProcedureDocument();
    const changed: DocumentSpikeV0 = structuredClone(base);
    const sprite = changed.targets.find((t) => !t.isStage)!;
    sprite.blocks.proto_id.mutation = {
      ...sprite.blocks.proto_id.mutation!,
      proccode: "other %s",
    };

    expect(equivalenceSpikeV0(base, changed)).toBe(false);
  });

  it("throws on missing block reference", () => {
    const blocks: Record<string, ScratchBlockSpikeV0> = {
      hat: {
        opcode: "event_whenflagclicked",
        next: "missing",
        parent: null,
        inputs: {},
        fields: {},
        topLevel: true,
      },
    };
    expect(() => scriptFingerprint(blocks, "hat")).toThrow(EquivalenceGraphError);
  });

  it("throws on cycle", () => {
    const blocks: Record<string, ScratchBlockSpikeV0> = {
      a: {
        opcode: "event_whenflagclicked",
        next: "b",
        parent: null,
        inputs: {},
        fields: {},
        topLevel: true,
      },
      b: {
        opcode: "motion_movesteps",
        next: "a",
        parent: "a",
        inputs: {},
        fields: {},
        topLevel: false,
      },
    };
    expect(() => scriptFingerprint(blocks, "a")).toThrow(EquivalenceGraphError);
  });

  it("does not mutate extension arrays on input documents", () => {
    const actual: DocumentSpikeV0 = {
      schemaVersion: 0,
      extensions: ["music", "pen"],
      targets: [],
    };
    const expected: DocumentSpikeV0 = {
      schemaVersion: 0,
      extensions: ["pen", "music"],
      targets: [],
    };
    const before = actual.extensions.join(",");
    equivalenceSpikeV0(actual, expected);
    expect(actual.extensions.join(",")).toBe(before);
    expect(equivalenceSpikeV0(actual, expected)).toBe(true);
  });

  it("uses stableJson for deterministic output", () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it("treats UID-regenerated SUBSTACK chains as equivalent", () => {
    const blocks = substackRepeatChainBlocks();
    const renamed = renameBlockGraph(blocks, {
      hat: "h2",
      rep: "r2",
      move: "m2",
      say: "s2",
    });
    const docA = docWithBlocks(blocks);
    const docB = docWithBlocks(renamed);
    expect(equivalenceSpikeV0(docA, docB)).toBe(true);
  });

  it("detects deletion of a later SUBSTACK block", () => {
    const full = substackRepeatChainBlocks();
    const trimmed = structuredClone(full);
    trimmed.move.next = null;
    delete trimmed.say;
    expect(equivalenceSpikeV0(docWithBlocks(full), docWithBlocks(trimmed))).toBe(
      false,
    );
  });

  it("detects insertion into a SUBSTACK chain", () => {
    const base = substackRepeatChainBlocks();
    const extended = structuredClone(base);
    extended.turn = {
      opcode: "motion_turnright",
      next: "say",
      parent: "rep",
      inputs: { DEGREES: [1, [4, "15"]] },
      fields: {},
      topLevel: false,
    };
    extended.move.next = "turn";
    extended.say.parent = "rep";
    expect(equivalenceSpikeV0(docWithBlocks(base), docWithBlocks(extended))).toBe(
      false,
    );
  });

  it("detects SUBSTACK chain reordering", () => {
    const base = substackRepeatChainBlocks();
    const swapped = structuredClone(base);
    swapped.move.next = null;
    swapped.say.next = "move";
    expect(equivalenceSpikeV0(docWithBlocks(base), docWithBlocks(swapped))).toBe(
      false,
    );
  });

  it("detects input changes on a later SUBSTACK block", () => {
    const base = substackRepeatChainBlocks();
    const changed = structuredClone(base);
    changed.say.inputs = { MESSAGE: [1, [10, "bye"]] };
    expect(equivalenceSpikeV0(docWithBlocks(base), docWithBlocks(changed))).toBe(
      false,
    );
  });

  it("compares SUBSTACK2 chains on if/else blocks", () => {
    const blocks: Record<string, ScratchBlockSpikeV0> = {
      hat: {
        opcode: "event_whenflagclicked",
        next: "iff",
        parent: null,
        inputs: {},
        fields: {},
        topLevel: true,
        x: 0,
        y: 0,
      },
      iff: {
        opcode: "control_if_else",
        next: null,
        parent: "hat",
        inputs: {
          CONDITION: [1, [10, "true"]],
          SUBSTACK: [2, "then1"],
          SUBSTACK2: [2, "else1"],
        },
        fields: {},
        topLevel: false,
      },
      then1: {
        opcode: "motion_movesteps",
        next: "then2",
        parent: "iff",
        inputs: { STEPS: [1, [4, "1"]] },
        fields: {},
        topLevel: false,
      },
      then2: {
        opcode: "motion_turnright",
        next: null,
        parent: "iff",
        inputs: { DEGREES: [1, [4, "90"]] },
        fields: {},
        topLevel: false,
      },
      else1: {
        opcode: "looks_say",
        next: "else2",
        parent: "iff",
        inputs: { MESSAGE: [1, [10, "no"]] },
        fields: {},
        topLevel: false,
      },
      else2: {
        opcode: "motion_movesteps",
        next: null,
        parent: "iff",
        inputs: { STEPS: [1, [4, "2"]] },
        fields: {},
        topLevel: false,
      },
    };

    const trimmed = structuredClone(blocks);
    trimmed.then2.next = null;
    delete trimmed.else2;
    trimmed.else1.next = null;

    expect(equivalenceSpikeV0(docWithBlocks(blocks), docWithBlocks(trimmed))).toBe(
      false,
    );
  });

  it("detects nested control blocks inside SUBSTACK chains", () => {
    const blocks: Record<string, ScratchBlockSpikeV0> = {
      hat: {
        opcode: "event_whenflagclicked",
        next: null,
        parent: null,
        inputs: { SUBSTACK: [2, "outer"] },
        fields: {},
        topLevel: true,
        x: 0,
        y: 0,
      },
      outer: {
        opcode: "control_repeat",
        next: null,
        parent: "hat",
        inputs: {
          TIMES: [1, [6, "3"]],
          SUBSTACK: [2, "inner_rep"],
        },
        fields: {},
        topLevel: false,
      },
      inner_rep: {
        opcode: "control_repeat",
        next: "after_inner",
        parent: "outer",
        inputs: {
          TIMES: [1, [6, "2"]],
          SUBSTACK: [2, "leaf"],
        },
        fields: {},
        topLevel: false,
      },
      leaf: {
        opcode: "motion_movesteps",
        next: null,
        parent: "inner_rep",
        inputs: { STEPS: [1, [4, "1"]] },
        fields: {},
        topLevel: false,
      },
      after_inner: {
        opcode: "looks_say",
        next: null,
        parent: "outer",
        inputs: { MESSAGE: [1, [10, "done"]] },
        fields: {},
        topLevel: false,
      },
    };

    const changed = structuredClone(blocks);
    delete changed.after_inner;
    changed.inner_rep.next = null;

    expect(equivalenceSpikeV0(docWithBlocks(blocks), docWithBlocks(changed))).toBe(
      false,
    );
  });
});
