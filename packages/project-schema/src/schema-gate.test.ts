import { describe, expect, it } from "vitest";
import {
  validateProject,
  type CostumeRef,
  type ProjectDocument,
  type ScratchTarget,
} from "./index.js";

function minimalCostume(
  name = "c1",
  assetId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
): CostumeRef {
  return {
    kind: "costume",
    name,
    assetId,
    md5ext: `${assetId}.svg`,
    dataFormat: "svg",
    contentSha256: "b".repeat(64),
    rotationCenterX: 0,
    rotationCenterY: 0,
  };
}

function v2Stage(overrides: Partial<ScratchTarget> = {}): ScratchTarget {
  return {
    id: "stage",
    name: "Stage",
    isStage: true,
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [minimalCostume("backdrop1", "cccccccccccccccccccccccccccccccc")],
    sounds: [],
    volume: 100,
    layerOrder: 0,
    tempo: 60,
    videoTransparency: 50,
    videoState: "on",
    textToSpeechLanguage: null,
    ...overrides,
  };
}

function v2Sprite(overrides: Partial<ScratchTarget> = {}): ScratchTarget {
  return {
    id: "s1",
    name: "Sprite1",
    isStage: false,
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [minimalCostume()],
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
    ...overrides,
  };
}

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

  it("rejects primitive block entry on schemaVersion 1", () => {
    const doc = v1Base();
    doc.targets[0]!.blocks = { shadow: [4, "10"] };
    const result = validateProject(doc);
    expect(result.ok).toBe(false);
    expect(
      result.issues.some(
        (i) =>
          i.code === "DISALLOWED_V1_FIELD" &&
          i.path === "targets.stage.blocks.shadow",
      ),
    ).toBe(true);
  });

  it("rejects invalid SB3 input mode", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [
        v2Sprite({
          blocks: {
            b1: {
              id: "b1",
              opcode: "event_whenflagclicked",
              next: null,
              parent: null,
              inputs: { BAD: [99, "x"] },
              fields: {},
              topLevel: true,
            },
          },
        }),
      ],
    };
    expect(validateProject(doc).ok).toBe(false);
    expect(
      validateProject(doc).issues.some((i) => i.code === "INVALID_INPUT_ENCODING"),
    ).toBe(true);
  });

  it("rejects procedures_prototype without required mutation", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [
        v2Sprite({
          blocks: {
            proto: {
              id: "proto",
              opcode: "procedures_prototype",
              next: null,
              parent: "def",
              inputs: {},
              fields: {},
              topLevel: false,
            },
          },
        }),
      ],
    };
    expect(validateProject(doc).ok).toBe(false);
    expect(
      validateProject(doc).issues.some((i) => i.code === "MISSING_MUTATION"),
    ).toBe(true);
  });

  it("rejects procedures_prototype with invalid mutation types", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [
        v2Sprite({
          blocks: {
            proto: {
              id: "proto",
              opcode: "procedures_prototype",
              next: null,
              parent: "def",
              inputs: {},
              fields: {},
              topLevel: false,
              mutation: {
                tagName: "mutation",
                children: [],
                proccode: 1,
                argumentids: [],
                argumentnames: null,
                argumentdefaults: {},
                warp: false,
              },
            },
          },
        }),
      ],
    };
    expect(validateProject(doc).ok).toBe(false);
    expect(
      validateProject(doc).issues.some((i) => i.code === "INVALID_MUTATION"),
    ).toBe(true);
  });

  it("rejects SB3 input mode 1 scalar literal", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [
        v2Sprite({
          blocks: {
            b1: {
              id: "b1",
              opcode: "motion_movesteps",
              next: null,
              parent: null,
              inputs: { STEPS: [1, 10] },
              fields: {},
              topLevel: true,
            },
          },
        }),
      ],
    };
    expect(validateProject(doc).ok).toBe(false);
    expect(
      validateProject(doc).issues.some((i) => i.code === "INVALID_INPUT_ENCODING"),
    ).toBe(true);
  });

  it("rejects SB3 input mode 2 with extra elements", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [
        v2Sprite({
          blocks: {
            b1: {
              id: "b1",
              opcode: "event_whenflagclicked",
              next: null,
              parent: null,
              inputs: { FLAG: [2, "x", "extra"] },
              fields: {},
              topLevel: true,
            },
          },
        }),
      ],
    };
    expect(validateProject(doc).ok).toBe(false);
    expect(
      validateProject(doc).issues.some((i) => i.code === "INVALID_INPUT_ENCODING"),
    ).toBe(true);
  });

  it("rejects SB3 input mode 3 with missing shadow id", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [
        v2Sprite({
          blocks: {
            b1: {
              id: "b1",
              opcode: "event_whenflagclicked",
              next: null,
              parent: null,
              inputs: { FLAG: [3, "x"] },
              fields: {},
              topLevel: true,
            },
          },
        }),
      ],
    };
    expect(validateProject(doc).ok).toBe(false);
    expect(
      validateProject(doc).issues.some((i) => i.code === "INVALID_INPUT_ENCODING"),
    ).toBe(true);
  });

  it("rejects short missing block id references in inputs", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [
        v2Sprite({
          blocks: {
            b1: {
              id: "b1",
              opcode: "event_whenflagclicked",
              next: null,
              parent: null,
              inputs: { FLAG: [2, "missing"] },
              fields: {},
              topLevel: true,
            },
          },
        }),
      ],
    };
    expect(validateProject(doc).ok).toBe(false);
    expect(
      validateProject(doc).issues.some((i) => i.code === "UNKNOWN_BLOCK_REF"),
    ).toBe(true);
  });

  it("rejects jpeg md5ext suffix even when dataFormat is jpg", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [
        v2Stage({
          costumes: [
            {
              ...minimalCostume(),
              dataFormat: "jpg",
              md5ext: `${minimalCostume().assetId}.jpeg`,
            },
          ],
        }),
      ],
    };
    expect(validateProject(doc).ok).toBe(false);
    expect(
      validateProject(doc).issues.some((i) => i.code === "INVALID_ASSET_REF"),
    ).toBe(true);
  });

  it("accepts mode 3 primitive shadow descriptors (vendor compressInputTree)", () => {
    const varId = "var-score";
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [
        v2Sprite({
          blocks: {
            set: {
              id: "set",
              opcode: "data_setvariableto",
              next: null,
              parent: null,
              inputs: { VALUE: [3, "add", [10, "0"]] },
              fields: { VARIABLE: ["score", varId] },
              topLevel: true,
            },
            add: {
              id: "add",
              opcode: "operator_add",
              next: null,
              parent: "set",
              inputs: {
                NUM1: [3, "var", [4, "0"]],
                NUM2: [1, [4, "3"]],
              },
              fields: {},
              topLevel: false,
            },
            var: {
              id: "var",
              opcode: "data_variable",
              next: null,
              parent: "add",
              inputs: {},
              fields: { VARIABLE: ["score", varId] },
              topLevel: false,
            },
          },
          variables: { [varId]: ["score", 0] },
        }),
      ],
    };
    expect(validateProject(doc).ok).toBe(true);
  });

  it("accepts vendor-style procedures_call mutation with warp null", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [
        v2Sprite({
          blocks: {
            call: {
              id: "call",
              opcode: "procedures_call",
              next: null,
              parent: null,
              inputs: {},
              fields: {},
              topLevel: true,
              mutation: {
                tagName: "mutation",
                children: [],
                proccode: "clear color",
                argumentids: "[]",
                warp: "null",
              },
            },
          },
        }),
      ],
    };
    expect(validateProject(doc).ok).toBe(true);
  });

  it("rejects procedures_call with proccode-only mutation", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [
        v2Sprite({
          blocks: {
            call: {
              id: "call",
              opcode: "procedures_call",
              next: null,
              parent: null,
              inputs: {},
              fields: {},
              topLevel: true,
              mutation: { proccode: "x" },
            },
          },
        }),
      ],
    };
    expect(validateProject(doc).ok).toBe(false);
    expect(
      validateProject(doc).issues.some((i) => i.code === "MISSING_MUTATION"),
    ).toBe(true);
  });

  it("rejects procedures_call when proccode placeholders disagree with argumentids", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [
        v2Sprite({
          blocks: {
            call: {
              id: "call",
              opcode: "procedures_call",
              next: null,
              parent: null,
              inputs: { input0: [1, [4, "10"]] },
              fields: {},
              topLevel: true,
              mutation: {
                tagName: "mutation",
                children: [],
                proccode: "no args here",
                argumentids: '["input0"]',
                warp: "null",
              },
            },
          },
        }),
      ],
    };
    expect(validateProject(doc).ok).toBe(false);
    expect(
      validateProject(doc).issues.some((i) => i.code === "INVALID_MUTATION"),
    ).toBe(true);
  });

  it("rejects duplicate procedure argument ids", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [
        v2Sprite({
          blocks: {
            proto: {
              id: "proto",
              opcode: "procedures_prototype",
              next: null,
              parent: "def",
              inputs: {},
              fields: {},
              topLevel: false,
              mutation: {
                tagName: "mutation",
                children: [],
                proccode: "dup %s %s",
                argumentids: '["input0","input0"]',
                argumentnames: '["a","b"]',
                argumentdefaults: '["",""]',
                warp: "false",
              },
            },
          },
        }),
      ],
    };
    expect(validateProject(doc).ok).toBe(false);
    expect(
      validateProject(doc).issues.some((i) => i.code === "INVALID_MUTATION"),
    ).toBe(true);
  });

  it("accepts multi-argument procedure prototype and call with matching placeholders", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [
        v2Sprite({
          blocks: {
            define_id: {
              id: "define_id",
              opcode: "procedures_definition",
              next: null,
              parent: null,
              inputs: { custom_block: [2, "proto"] },
              fields: {},
              topLevel: true,
            },
            call: {
              id: "call",
              opcode: "procedures_call",
              next: null,
              parent: null,
              inputs: {
                input0: [1, [4, "1"]],
                input1: [1, [10, "hi"]],
              },
              fields: {},
              topLevel: true,
              mutation: {
                tagName: "mutation",
                children: [],
                proccode: "foo %n %s",
                argumentids: '["input0","input1"]',
                warp: "false",
              },
            },
            proto: {
              id: "proto",
              opcode: "procedures_prototype",
              next: null,
              parent: "define_id",
              inputs: {},
              fields: {},
              topLevel: false,
              mutation: {
                tagName: "mutation",
                children: [],
                proccode: "foo %n %s",
                argumentids: '["input0","input1"]',
                argumentnames: '["num","msg"]',
                argumentdefaults: '["0",""]',
                warp: "false",
              },
            },
          },
        }),
      ],
    };
    expect(validateProject(doc).ok).toBe(true);
  });

  it("rejects costume assetId that does not match md5ext stem", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [
        v2Stage({
          costumes: [
            {
              ...minimalCostume(),
              assetId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            },
          ],
        }),
      ],
    };
    expect(validateProject(doc).ok).toBe(false);
    expect(
      validateProject(doc).issues.some((i) => i.code === "INVALID_ASSET_REF"),
    ).toBe(true);
  });

  it("rejects invalid monitors type", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: "invalid" as unknown as unknown[],
      targets: [v2Stage()],
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
        v2Stage({
          comments: [] as unknown as Record<string, unknown>,
        }),
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
        v2Sprite({
          currentCostume: 2,
          costumes: [
            minimalCostume("a"),
            minimalCostume("b", "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"),
          ],
        }),
      ],
    };
    expect(
      validateProject(doc).issues.some(
        (i) => i.code === "INVALID_CURRENT_COSTUME",
      ),
    ).toBe(true);
  });
});

describe("V2 durable target assets (§6.4)", () => {
  it("rejects currentCostume when costumes is omitted", () => {
    const target = v2Sprite();
    delete target.costumes;
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [target],
    };
    const result = validateProject(doc);
    expect(result.ok).toBe(false);
    expect(
      result.issues.some((i) => i.code === "INVALID_DOCUMENT") ||
        result.issues.some((i) => i.code === "INVALID_CURRENT_COSTUME"),
    ).toBe(true);
  });

  it("rejects empty costumes array on stage", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [v2Stage({ costumes: [] })],
    };
    expect(
      validateProject(doc).issues.some((i) => i.code === "INVALID_DOCUMENT"),
    ).toBe(true);
  });

  it("rejects missing currentCostume on sprite", () => {
    const target = v2Sprite();
    delete target.currentCostume;
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [target],
    };
    expect(
      validateProject(doc).issues.some(
        (i) => i.code === "INVALID_CURRENT_COSTUME",
      ),
    ).toBe(true);
  });

  it("rejects negative currentCostume", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [v2Sprite({ currentCostume: -1 })],
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
        v2Sprite({
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
        }),
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

describe("extension document vs server allow-list", () => {
  function musicBlockDoc(extensions?: string[]): ProjectDocument {
    return {
      schemaVersion: 2,
      extensions,
      monitors: [],
      targets: [
        v2Sprite({
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
        }),
      ],
    };
  }

  it("rejects when options allow music but document omits extensions", () => {
    const doc = musicBlockDoc(undefined);
    delete doc.extensions;
    expect(
      validateProject(doc, { allowedExtensions: ["music"] }).ok,
    ).toBe(false);
  });

  it("rejects when options allow music but document extensions is empty", () => {
    expect(
      validateProject(musicBlockDoc([]), { allowedExtensions: ["music"] }).ok,
    ).toBe(false);
  });

  it("accepts when both document and options declare music", () => {
    expect(
      validateProject(musicBlockDoc(["music"]), {
        allowedExtensions: ["music"],
      }).ok,
    ).toBe(true);
  });

  it("rejects when document declares music but options omit it", () => {
    expect(
      validateProject(musicBlockDoc(["music"]), {
        allowedExtensions: ["pen"],
      }).ok,
    ).toBe(false);
  });
});

describe("unknown field allow-list (§6.4 / §6.5)", () => {
  it("rejects unknown top-level field on V2", () => {
    const doc = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [v2Stage()],
      evilTop: true,
    } as ProjectDocument;
    expect(
      validateProject(doc).issues.some(
        (i) => i.code === "UNKNOWN_DOCUMENT_FIELD" && i.path === "evilTop",
      ),
    ).toBe(true);
  });

  it("rejects unknown target field on V2", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [
        {
          ...v2Stage(),
          scripts: [] as unknown as Record<string, unknown>,
        } as ScratchTarget,
      ],
    };
    expect(
      validateProject(doc).issues.some(
        (i) =>
          i.code === "UNKNOWN_DOCUMENT_FIELD" &&
          i.path === "targets.stage.scripts",
      ),
    ).toBe(true);
  });

  it("rejects unknown block field on V2", () => {
    const doc: ProjectDocument = {
      schemaVersion: 2,
      extensions: [],
      monitors: [],
      targets: [
        v2Sprite({
          blocks: {
            b: {
              id: "b",
              opcode: "event_whenflagclicked",
              next: null,
              parent: null,
              inputs: {},
              fields: {},
              topLevel: true,
              extra: true,
            } as ScratchTarget["blocks"][string],
          },
        }),
      ],
    };
    expect(
      validateProject(doc).issues.some(
        (i) =>
          i.code === "UNKNOWN_DOCUMENT_FIELD" &&
          i.path === "targets.s1.blocks.b.extra",
      ),
    ).toBe(true);
  });

  it("rejects unknown top-level field on V1", () => {
    const doc = v1Base();
    (doc as unknown as Record<string, unknown>).surprise = 1;
    expect(
      validateProject(doc).issues.some(
        (i) => i.code === "UNKNOWN_DOCUMENT_FIELD",
      ),
    ).toBe(true);
  });
});
