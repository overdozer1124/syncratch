import { describe, expect, it } from "vitest";
import { allowedOpcodeSet, CORPUS_OPCODES } from "./scratch-opcodes.js";
import { validateProject, type ProjectDocument } from "./index.js";

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
        {
          id: "s1",
          name: "Sprite1",
          isStage: false,
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
          comments: {},
        },
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
        {
          id: "stage",
          name: "Stage",
          isStage: true,
          blocks: {},
          comments: {},
        },
        {
          id: "s1",
          name: "Twin",
          isStage: false,
          blocks: {},
          comments: {},
        },
        {
          id: "s2",
          name: "Twin",
          isStage: false,
          blocks: {},
          comments: {},
        },
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
      targets: [
        {
          id: "stage",
          name: "Stage",
          isStage: true,
          blocks: {},
          comments: {},
        },
      ],
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
      targets: [
        {
          id: "stage",
          name: "Stage",
          isStage: true,
          blocks: {},
          comments: { c1: { text: "nope" } },
        },
      ],
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
        {
          id: "s1",
          name: "Sprite1",
          isStage: false,
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
          comments: {},
        },
      ],
    };
    expect(
      validateProject(doc).issues.some((i) => i.code === "DISALLOWED_BLOCK_FIELD"),
    ).toBe(true);
  });
});
