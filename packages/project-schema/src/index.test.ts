import { describe, expect, it } from "vitest";
import {
  emptyProject,
  validateProject,
  type ProjectDocument,
} from "../src/index.js";

describe("validateProject", () => {
  it("accepts empty stage project", () => {
    const r = validateProject(emptyProject());
    expect(r.ok).toBe(true);
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
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "DUPLICATE_BLOCK_ID")).toBe(true);
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
    const r = validateProject(doc);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "PARENT_NEXT_MISMATCH")).toBe(true);
  });

  it("rejects cycles in next chain", () => {
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
              next: "a",
              parent: "a",
              inputs: {},
              fields: {},
              topLevel: false,
            },
          },
        },
      ],
    };
    const r = validateProject(doc);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "CYCLE_DETECTED")).toBe(true);
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
    const r = validateProject(doc);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.code === "MISSING_VARIABLE_REF")).toBe(true);
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
    const r = validateProject(doc);
    expect(r.ok).toBe(true);
  });
});
