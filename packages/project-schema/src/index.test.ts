import { describe, expect, it } from "vitest";
import {
  emptyProject,
  validateProject,
  extensionIdFromOpcode,
  type ProjectDocument,
} from "../src/index.js";

describe("validateProject", () => {
  it("accepts empty stage project", () => {
    expect(validateProject(emptyProject()).ok).toBe(true);
  });

  it("rejects duplicate block ids across targets", () => {
    const doc: ProjectDocument = {
      schemaVersion: 1,
      targets: [
        {
          id: "stage",
          name: "Stage",
          isStage: true,
          blocks: {
            a: {
              id: "a",
              opcode: "event_whenflagclicked",
              next: null,
              parent: null,
              inputs: {},
              fields: {},
              topLevel: true,
            },
          },
        },
        {
          id: "s1",
          name: "Sprite1",
          isStage: false,
          blocks: {
            a: {
              id: "a",
              opcode: "event_whenflagclicked",
              next: null,
              parent: null,
              inputs: {},
              fields: {},
              topLevel: true,
            },
          },
        },
      ],
    };
    const r = validateProject(doc);
    expect(r.issues.some((i) => i.code === "DUPLICATE_BLOCK_ID")).toBe(true);
  });

  it("rejects duplicate target ids", () => {
    const doc: ProjectDocument = {
      schemaVersion: 1,
      targets: [
        {
          id: "same",
          name: "A",
          isStage: true,
          blocks: {},
        },
        {
          id: "same",
          name: "B",
          isStage: false,
          blocks: {},
        },
      ],
    };
    expect(
      validateProject(doc).issues.some((i) => i.code === "DUPLICATE_TARGET_ID"),
    ).toBe(true);
  });

  it("rejects map key / block.id mismatch", () => {
    const doc: ProjectDocument = {
      schemaVersion: 1,
      targets: [
        {
          id: "s1",
          name: "Sprite1",
          isStage: false,
          blocks: {
            key: {
              id: "other",
              opcode: "motion_movesteps",
              next: null,
              parent: null,
              inputs: {},
              fields: {},
              topLevel: true,
            },
          },
        },
      ],
    };
    expect(
      validateProject(doc).issues.some((i) => i.code === "BLOCK_ID_MISMATCH"),
    ).toBe(true);
  });

  it("rejects next/parent mismatch", () => {
    const doc: ProjectDocument = {
      schemaVersion: 1,
      targets: [
        {
          id: "s1",
          name: "Sprite1",
          isStage: false,
          blocks: {
            hat: {
              id: "hat",
              opcode: "event_whenflagclicked",
              next: "move",
              parent: null,
              inputs: {},
              fields: {},
              topLevel: true,
            },
            move: {
              id: "move",
              opcode: "motion_movesteps",
              next: null,
              parent: null,
              inputs: {},
              fields: {},
              topLevel: false,
            },
          },
        },
      ],
    };
    expect(
      validateProject(doc).issues.some((i) => i.code === "PARENT_NEXT_MISMATCH"),
    ).toBe(true);
  });

  it("rejects cycles via input edges", () => {
    const doc: ProjectDocument = {
      schemaVersion: 1,
      targets: [
        {
          id: "s1",
          name: "Sprite1",
          isStage: false,
          blocks: {
            a: {
              id: "a",
              opcode: "control_if",
              next: null,
              parent: null,
              inputs: { SUBSTACK: [2, "b"] },
              fields: {},
              topLevel: true,
            },
            b: {
              id: "b",
              opcode: "control_if",
              next: null,
              parent: "a",
              inputs: { SUBSTACK: [2, "a"] },
              fields: {},
              topLevel: false,
            },
          },
        },
      ],
    };
    expect(
      validateProject(doc).issues.some((i) => i.code === "CYCLE_DETECTED"),
    ).toBe(true);
  });

  it("does not accept LIST field pointing at a variable id", () => {
    const doc: ProjectDocument = {
      schemaVersion: 1,
      targets: [
        {
          id: "s1",
          name: "Sprite1",
          isStage: false,
          variables: { v1: ["score", 0] },
          lists: {},
          blocks: {
            set: {
              id: "set",
              opcode: "data_addtolist",
              next: null,
              parent: null,
              inputs: {},
              fields: { LIST: ["score", "v1"] },
              topLevel: true,
            },
          },
        },
      ],
    };
    expect(
      validateProject(doc).issues.some((i) => i.code === "MISSING_LIST_REF"),
    ).toBe(true);
  });

  it("rejects missing variable reference", () => {
    const doc: ProjectDocument = {
      schemaVersion: 1,
      targets: [
        {
          id: "s1",
          name: "Sprite1",
          isStage: false,
          variables: {},
          blocks: {
            set: {
              id: "set",
              opcode: "data_setvariableto",
              next: null,
              parent: null,
              inputs: {},
              fields: { VARIABLE: ["score", "missing-id"] },
              topLevel: true,
            },
          },
        },
      ],
    };
    expect(
      validateProject(doc).issues.some((i) => i.code === "MISSING_VARIABLE_REF"),
    ).toBe(true);
  });

  it("rejects INPUT_MULTI_OCCUPANT", () => {
    const doc: ProjectDocument = {
      schemaVersion: 1,
      targets: [
        {
          id: "s1",
          name: "Sprite1",
          isStage: false,
          blocks: {
            parent: {
              id: "parent",
              opcode: "control_if",
              next: null,
              parent: null,
              inputs: { SUBSTACK: [2, "a", "b"] },
              fields: {},
              topLevel: true,
            },
            a: {
              id: "a",
              opcode: "motion_movesteps",
              next: null,
              parent: "parent",
              inputs: {},
              fields: {},
              topLevel: false,
            },
            b: {
              id: "b",
              opcode: "motion_movesteps",
              next: null,
              parent: "parent",
              inputs: {},
              fields: {},
              topLevel: false,
            },
          },
        },
      ],
    };
    expect(
      validateProject(doc).issues.some((i) => i.code === "INPUT_MULTI_OCCUPANT"),
    ).toBe(true);
  });

  it("rejects missing target references", () => {
    const doc: ProjectDocument = {
      schemaVersion: 1,
      targets: [
        {
          id: "s1",
          name: "Sprite1",
          isStage: false,
          blocks: {
            go: {
              id: "go",
              opcode: "sensing_of",
              next: null,
              parent: null,
              inputs: {},
              fields: { OBJECT: ["Ghost", null] },
              topLevel: true,
            },
          },
        },
      ],
    };
    // TOWARDS-like: use CLONE_OPTION / sensing fields — OBJECT isn't checked;
    // use explicit TOWARDS via motion_pointtowards field TO
    doc.targets[0]!.blocks = {
      pt: {
        id: "pt",
        opcode: "motion_pointtowards",
        next: null,
        parent: null,
        inputs: {},
        fields: { TOWARDS: ["Ghost", null] },
        topLevel: true,
      },
    };
    expect(
      validateProject(doc).issues.some((i) => i.code === "MISSING_TARGET_REF"),
    ).toBe(true);
  });

  it("rejects unknown extension opcodes not in extensions list", () => {
    expect(extensionIdFromOpcode("music_playDrumForBeats")).toBe("music");
    const doc: ProjectDocument = {
      schemaVersion: 1,
      extensions: [],
      targets: [
        {
          id: "s1",
          name: "Sprite1",
          isStage: false,
          blocks: {
            m: {
              id: "m",
              opcode: "music_playDrumForBeats",
              next: null,
              parent: null,
              inputs: {},
              fields: {},
              topLevel: true,
            },
          },
        },
      ],
    };
    expect(
      validateProject(doc).issues.some((i) => i.code === "EXTENSION_NOT_ALLOWED"),
    ).toBe(true);
  });

  it("accepts well-formed stack", () => {
    const doc: ProjectDocument = {
      schemaVersion: 1,
      targets: [
        {
          id: "s1",
          name: "Sprite1",
          isStage: false,
          variables: { v1: ["score", 0] },
          blocks: {
            hat: {
              id: "hat",
              opcode: "event_whenflagclicked",
              next: "set",
              parent: null,
              inputs: {},
              fields: {},
              topLevel: true,
            },
            set: {
              id: "set",
              opcode: "data_setvariableto",
              next: null,
              parent: "hat",
              inputs: { VALUE: [1, [10, "1"]] },
              fields: { VARIABLE: ["score", "v1"] },
              topLevel: false,
            },
          },
        },
      ],
    };
    expect(validateProject(doc).ok).toBe(true);
  });
});
