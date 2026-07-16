import { describe, expect, it } from "vitest";
import { validateProject, type ProjectDocument } from "./index.js";

function v1Base(): ProjectDocument {
  return {
    schemaVersion: 1,
    extensions: [],
    targets: [
      {
        id: "stage",
        name: "Stage",
        isStage: true,
        blocks: {},
      },
    ],
  };
}

describe("schemaVersion 1 field gate", () => {
  it("rejects block mutation on schemaVersion 1", () => {
    const doc = v1Base();
    doc.targets[0]!.blocks = {
      b: {
        id: "b",
        opcode: "event_whenflagclicked",
        next: null,
        parent: null,
        inputs: {},
        fields: {},
        topLevel: true,
        mutation: { proccode: "nope" },
      },
    };
    const result = validateProject(doc);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.code === "DISALLOWED_V1_FIELD")).toBe(
      true,
    );
  });

  it("rejects monitors on schemaVersion 1", () => {
    const doc = v1Base();
    doc.monitors = [];
    expect(
      validateProject(doc).issues.some((i) => i.code === "DISALLOWED_V1_FIELD"),
    ).toBe(true);
  });

  it("rejects V2 asset fields on schemaVersion 1", () => {
    const doc = v1Base();
    doc.targets[0]!.costumes = [];
    expect(
      validateProject(doc).issues.some((i) => i.code === "DISALLOWED_V1_FIELD"),
    ).toBe(true);
  });

  it("rejects invalid monitors type", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: "invalid" as unknown as unknown[],
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

  it("rejects invalid comments type (array)", () => {
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
          comments: [] as unknown as Record<string, unknown>,
        },
      ],
    };
    expect(
      validateProject(doc).issues.some((i) => i.code === "INVALID_COMMENTS"),
    ).toBe(true);
  });

  it("rejects currentCostume out of range", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [
        {
          id: "s1",
          name: "Sprite1",
          isStage: false,
          blocks: {},
          comments: {},
          currentCostume: 2,
          costumes: [
            {
              kind: "costume",
              name: "a",
              assetId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              md5ext: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.svg",
              dataFormat: "svg",
              contentSha256: "b".repeat(64),
              rotationCenterX: 0,
              rotationCenterY: 0,
            },
            {
              kind: "costume",
              name: "b",
              assetId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              md5ext: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.svg",
              dataFormat: "svg",
              contentSha256: "c".repeat(64),
              rotationCenterX: 0,
              rotationCenterY: 0,
            },
          ],
        },
      ],
    };
    expect(
      validateProject(doc).issues.some(
        (i) => i.code === "INVALID_CURRENT_COSTUME",
      ),
    ).toBe(true);
  });
});

describe("extension opcode declaration (§6.6.1)", () => {
  function musicBlockDoc(extensions?: string[]): ProjectDocument {
    return {
      schemaVersion: 2,
      extensions,
      monitors: [],
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
          comments: {},
        },
      ],
    };
  }

  it("rejects music opcode when extensions is omitted", () => {
    const doc = musicBlockDoc(undefined);
    delete doc.extensions;
    expect(
      validateProject(doc).issues.some((i) => i.code === "EXTENSION_NOT_ALLOWED"),
    ).toBe(true);
  });

  it("rejects music opcode when extensions is empty", () => {
    expect(
      validateProject(musicBlockDoc([])).issues.some(
        (i) => i.code === "EXTENSION_NOT_ALLOWED",
      ),
    ).toBe(true);
  });

  it("accepts music opcode when extensions declares music", () => {
    expect(validateProject(musicBlockDoc(["music"])).ok).toBe(true);
  });

  it("rejects disallowed extension id in project.extensions", () => {
    const doc = musicBlockDoc(["wedo2"]);
    expect(
      validateProject(doc).issues.some(
        (i) => i.code === "DISALLOWED_EXTENSION_ID",
      ),
    ).toBe(true);
  });
});
