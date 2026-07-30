import {describe, expect, it} from "vitest";
import type {ProjectDocument, ScratchBlock} from "@blocksync/project-schema";
import {
  buildDiagnosticProjectIR,
  inputOccupantBlockId,
  normalizeDiagnosticInput,
  walkDiagnosticStack,
} from "./ir.js";

function block(
  id: string,
  opcode: string,
  overrides: Partial<ScratchBlock> = {},
): ScratchBlock {
  return {
    id,
    opcode,
    next: overrides.next ?? null,
    parent: overrides.parent ?? null,
    inputs: overrides.inputs ?? {},
    fields: overrides.fields ?? {},
    ...(overrides.shadow !== undefined ? {shadow: overrides.shadow} : {}),
    ...(overrides.topLevel !== undefined ? {topLevel: overrides.topLevel} : {}),
    ...(overrides.mutation !== undefined ? {mutation: overrides.mutation} : {}),
  };
}

function doc(
  targets: ProjectDocument["targets"],
): ProjectDocument {
  return {schemaVersion: 1, targets};
}

describe("normalizeDiagnosticInput", () => {
  it("treats mode-1 string as shadow-only", () => {
    const input = normalizeDiagnosticInput([1, "menu"]);
    expect(input.mode).toBe(1);
    expect(input.shadowBlockId).toBe("menu");
    expect(input.primaryBlockId).toBeNull();
    expect(input.blockRefs).toEqual(["menu"]);
  });

  it("captures inline primitive shadows", () => {
    const input = normalizeDiagnosticInput([1, [4, "10"]]);
    expect(input.inlinePrimitive).toEqual([4, "10"]);
    expect(input.primaryBlockId).toBeNull();
    expect(input.shadowBlockId).toBeNull();
  });

  it("marks empty SUBSTACK as empty", () => {
    const input = normalizeDiagnosticInput([2, null]);
    expect(input.mode).toBe(2);
    expect(input.empty).toBe(true);
    expect(inputOccupantBlockId(input)).toBeNull();
  });

  it("separates primary and shadow in mode 3", () => {
    const input = normalizeDiagnosticInput([3, "real", "shadow"]);
    expect(input.primaryBlockId).toBe("real");
    expect(input.shadowBlockId).toBe("shadow");
    expect(input.blockRefs).toEqual(["real", "shadow"]);
    expect(inputOccupantBlockId(input)).toBe("real");
  });
});

describe("buildDiagnosticProjectIR", () => {
  it("preserves next and parent links without mutating the document", () => {
    const document = doc([
      {
        id: "s1",
        name: "Sprite1",
        isStage: false,
        blocks: {
          hat: block("hat", "event_whenflagclicked", {
            next: "move",
            parent: null,
            topLevel: true,
          }),
          move: block("move", "motion_movesteps", {
            next: null,
            parent: "hat",
            inputs: {STEPS: [1, [4, "10"]]},
          }),
        },
      },
    ]);
    const originalNext = (document.targets[0]!.blocks.hat as ScratchBlock).next;

    const ir = buildDiagnosticProjectIR(document);
    const blocks = ir.targets[0]!.blocksById;
    expect(blocks.get("hat")?.nextId).toBe("move");
    expect(blocks.get("move")?.parentId).toBe("hat");
    expect(blocks.get("hat")?.topLevel).toBe(true);
    expect(ir.targets[0]!.scriptRootIds).toEqual(["hat"]);

    // Source document untouched.
    expect((document.targets[0]!.blocks.hat as ScratchBlock).next).toBe(
      originalNext,
    );
    (document.targets[0]!.blocks.hat as ScratchBlock).next = "mutated";
    expect(blocks.get("hat")?.nextId).toBe("move");
  });

  it("reads SUBSTACK and SUBSTACK2 occupants", () => {
    const ir = buildDiagnosticProjectIR(
      doc([
        {
          id: "s1",
          name: "Sprite1",
          isStage: false,
          blocks: {
            hat: block("hat", "event_whenflagclicked", {
              next: "iff",
              parent: null,
              topLevel: true,
            }),
            iff: block("iff", "control_if_else", {
              next: null,
              parent: "hat",
              inputs: {
                CONDITION: [2, "cond"],
                SUBSTACK: [2, "thenBody"],
                SUBSTACK2: [2, "elseBody"],
              },
            }),
            cond: block("cond", "operator_gt", {
              parent: "iff",
              shadow: false,
            }),
            thenBody: block("thenBody", "motion_movesteps", {
              parent: "iff",
            }),
            elseBody: block("elseBody", "looks_say", {parent: "iff"}),
          },
        },
      ]),
    );

    const iff = ir.targets[0]!.blocksById.get("iff")!;
    expect(iff.inputs.get("SUBSTACK")?.primaryBlockId).toBe("thenBody");
    expect(iff.inputs.get("SUBSTACK2")?.primaryBlockId).toBe("elseBody");
    expect(iff.inputs.get("CONDITION")?.primaryBlockId).toBe("cond");

    // Stack walk follows next + SUBSTACK/SUBSTACK2 (not reporter CONDITION).
    const visited: string[] = [];
    walkDiagnosticStack(ir.targets[0]!.blocksById, "hat", b => {
      visited.push(b.id);
    });
    expect(visited.sort()).toEqual(
      ["elseBody", "hat", "iff", "thenBody"].sort(),
    );
    expect(ir.targets[0]!.blocksById.has("cond")).toBe(true);
  });

  it("captures primitive shadow on motion steps", () => {
    const ir = buildDiagnosticProjectIR(
      doc([
        {
          id: "s1",
          name: "Sprite1",
          isStage: false,
          blocks: {
            move: block("move", "motion_movesteps", {
              topLevel: true,
              parent: null,
              inputs: {STEPS: [1, [4, "10"]]},
            }),
          },
        },
      ]),
    );
    const steps = ir.targets[0]!.blocksById.get("move")!.inputs.get("STEPS")!;
    expect(steps.inlinePrimitive).toEqual([4, "10"]);
    expect(steps.shadowBlockId).toBeNull();
  });

  it("resolves broadcast menu shadow via BROADCAST_INPUT", () => {
    const broadcastId = "bcast-1";
    const ir = buildDiagnosticProjectIR(
      doc([
        {
          id: "stage",
          name: "Stage",
          isStage: true,
          broadcasts: {[broadcastId]: "start"},
          blocks: {},
        },
        {
          id: "s1",
          name: "Sprite1",
          isStage: false,
          blocks: {
            send: block("send", "event_broadcast", {
              topLevel: true,
              parent: null,
              inputs: {BROADCAST_INPUT: [1, "menu"]},
            }),
            menu: block("menu", "event_broadcast_menu", {
              shadow: true,
              parent: "send",
              fields: {BROADCAST_OPTION: ["start", broadcastId]},
            }),
            recv: block("recv", "event_whenbroadcastreceived", {
              topLevel: true,
              parent: null,
              fields: {BROADCAST_OPTION: ["start", broadcastId]},
            }),
          },
        },
      ]),
    );

    expect(ir.broadcastsById.get(broadcastId)?.name).toBe("start");
    const send = ir.targets[1]!.blocksById.get("send")!;
    const menuInput = send.inputs.get("BROADCAST_INPUT")!;
    expect(menuInput.shadowBlockId).toBe("menu");
    expect(inputOccupantBlockId(menuInput)).toBe("menu");
    const menu = ir.targets[1]!.blocksById.get("menu")!;
    expect(menu.shadow).toBe(true);
    expect(menu.fields.get("BROADCAST_OPTION")?.value).toBe("start");
    expect(menu.fields.get("BROADCAST_OPTION")?.id).toBe(broadcastId);
  });

  it("includes every object block once and stays cycle-safe", () => {
    const document = doc([
      {
        id: "s1",
        name: "Sprite1",
        isStage: false,
        blocks: {
          a: block("a", "control_forever", {
            next: "b",
            parent: null,
            topLevel: true,
            inputs: {SUBSTACK: [2, "b"]},
          }),
          b: block("b", "motion_movesteps", {
            next: "a",
            parent: "a",
            inputs: {STEPS: [1, [4, "1"]]},
          }),
          orphan: block("orphan", "looks_say", {
            next: "orphan",
            parent: null,
            topLevel: true,
          }),
        },
      },
    ]);

    const started = Date.now();
    const ir = buildDiagnosticProjectIR(document);
    expect(Date.now() - started).toBeLessThan(1000);

    const ids = [...ir.targets[0]!.blocksById.keys()].sort();
    expect(ids).toEqual(["a", "b", "orphan"]);

    const visited: string[] = [];
    walkDiagnosticStack(ir.targets[0]!.blocksById, "a", b => {
      visited.push(b.id);
    });
    expect(visited.sort()).toEqual(["a", "b"]);
    expect(visited.length).toBe(2);

    // Deterministic for identical input.
    const again = buildDiagnosticProjectIR(document);
    expect([...again.targets[0]!.blocksById.keys()]).toEqual(ids);
    expect(again.targets[0]!.scriptRootIds).toEqual(
      ir.targets[0]!.scriptRootIds,
    );
  });

  it("indexes variables and lists by id", () => {
    const ir = buildDiagnosticProjectIR(
      doc([
        {
          id: "stage",
          name: "Stage",
          isStage: true,
          variables: {v1: ["score", 0]},
          lists: {l1: ["items", []]},
          blocks: {},
        },
      ]),
    );
    expect(ir.variablesById.get("v1")).toEqual({
      id: "v1",
      name: "score",
      targetId: "stage",
      value: 0,
    });
    expect(ir.listsById.get("l1")?.name).toBe("items");
  });
});
