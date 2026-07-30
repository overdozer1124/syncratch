import {describe, expect, it} from "vitest";
import type {ProjectDocument, ScratchBlock} from "@blocksync/project-schema";
import {schemaFindingsFromDocument} from "./schema-findings.js";

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
    ...(overrides.topLevel !== undefined ? {topLevel: overrides.topLevel} : {}),
    ...(overrides.shadow !== undefined ? {shadow: overrides.shadow} : {}),
  };
}

describe("schemaFindingsFromDocument", () => {
  it("maps missing variable refs to integrity findings", () => {
    const doc: ProjectDocument = {
      schemaVersion: 1,
      targets: [
        {
          id: "s1",
          name: "Sprite1",
          isStage: false,
          variables: {},
          blocks: {
            set: block("set", "data_setvariableto", {
              topLevel: true,
              parent: null,
              fields: {VARIABLE: ["score", "missing-var"]},
              inputs: {VALUE: [1, [10, "0"]]},
            }),
          },
        },
      ],
    };
    const findings = schemaFindingsFromDocument(doc);
    const hit = findings.find(f => f.ruleId === "schema.MISSING_VARIABLE_REF");
    expect(hit).toBeDefined();
    expect(hit?.severity).toBe("integrity");
    expect(hit?.confidence).toBe("certain");
    expect(hit?.evidence[0]?.detail).toContain("MISSING_VARIABLE_REF");
    expect(hit?.blockIds).toContain("set");
  });

  it("maps missing broadcast refs to integrity findings", () => {
    const doc: ProjectDocument = {
      schemaVersion: 1,
      targets: [
        {
          id: "s1",
          name: "Sprite1",
          isStage: false,
          broadcasts: {},
          blocks: {
            recv: block("recv", "event_whenbroadcastreceived", {
              topLevel: true,
              parent: null,
              fields: {BROADCAST_OPTION: ["ghost", "no-such-bcast"]},
            }),
          },
        },
      ],
    };
    const findings = schemaFindingsFromDocument(doc);
    expect(
      findings.some(f => f.ruleId === "schema.MISSING_BROADCAST_REF"),
    ).toBe(true);
  });

  it("maps parent/next mismatch and cycles as integrity, not learner blame", () => {
    const doc: ProjectDocument = {
      schemaVersion: 1,
      targets: [
        {
          id: "s1",
          name: "Sprite1",
          isStage: false,
          blocks: {
            a: block("a", "event_whenflagclicked", {
              next: "b",
              parent: null,
              topLevel: true,
            }),
            b: block("b", "motion_movesteps", {
              next: null,
              parent: null, // mismatch: a.next=b but b.parent!=a
              topLevel: false,
            }),
          },
        },
      ],
    };
    const findings = schemaFindingsFromDocument(doc);
    expect(findings.every(f => f.severity === "integrity")).toBe(true);
    expect(findings.some(f => f.ruleId === "schema.PARENT_NEXT_MISMATCH")).toBe(
      true,
    );
  });

  it("maps unknown block refs and duplicate ids", () => {
    const doc: ProjectDocument = {
      schemaVersion: 1,
      targets: [
        {
          id: "s1",
          name: "Sprite1",
          isStage: false,
          blocks: {
            hat: block("hat", "event_whenflagclicked", {
              next: "ghost",
              parent: null,
              topLevel: true,
            }),
          },
        },
        {
          id: "s2",
          name: "Sprite2",
          isStage: false,
          blocks: {
            hat: block("hat", "event_whenflagclicked", {
              next: null,
              parent: null,
              topLevel: true,
            }),
          },
        },
      ],
    };
    const findings = schemaFindingsFromDocument(doc);
    expect(findings.some(f => f.ruleId === "schema.UNKNOWN_BLOCK_REF")).toBe(
      true,
    );
    expect(findings.some(f => f.ruleId === "schema.DUPLICATE_BLOCK_ID")).toBe(
      true,
    );
  });

  it("deduplicates equivalent integrity findings", () => {
    const doc: ProjectDocument = {
      schemaVersion: 1,
      targets: [
        {
          id: "s1",
          name: "Sprite1",
          isStage: false,
          blocks: {
            a: block("a", "motion_movesteps", {
              next: "a",
              parent: null,
              topLevel: true,
            }),
          },
        },
      ],
    };
    const findings = schemaFindingsFromDocument(doc);
    const keys = new Set(
      findings.map(f => `${f.ruleId}:${f.evidence[0]?.detail}`),
    );
    expect(keys.size).toBe(findings.length);
  });
});
