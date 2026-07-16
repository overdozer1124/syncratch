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
});
