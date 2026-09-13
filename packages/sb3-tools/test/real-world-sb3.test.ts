import {describe, expect, it} from "vitest";
import JSZip from "jszip";
import {createHash} from "node:crypto";
import {
  DEFAULT_LIMITS,
  findProjectRootPrefix,
  loadSb3,
} from "../src/index.js";

/**
 * Shapes that ordinary Scratch projects have and that import used to refuse.
 *
 * Each case here was measured against a real .sb3 before it was written down:
 * the vendored scratch-vm and scratch-gui fixtures are Scratch's own output,
 * and 10 of the 44 in that corpus were unopenable for the reasons below.
 */

const md5 = (b: Uint8Array) => createHash("md5").update(b).digest("hex");

const SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2">' +
    '<rect width="2" height="2" fill="#fff"/></svg>',
);
const SVG_ID = md5(SVG);

type Target = Record<string, unknown>;

function project(): {json: Record<string, unknown>; stage: Target; sprite: Target} {
  const costume = () => ({
    assetId: SVG_ID,
    name: "costume1",
    md5ext: `${SVG_ID}.svg`,
    dataFormat: "svg",
    rotationCenterX: 0,
    rotationCenterY: 0,
  });
  const stage: Target = {
    isStage: true,
    name: "Stage",
    variables: {},
    lists: {},
    broadcasts: {},
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [costume()],
    sounds: [],
    volume: 100,
    layerOrder: 0,
    tempo: 60,
    videoTransparency: 50,
    videoState: "on",
    textToSpeechLanguage: null,
  };
  const sprite: Target = {
    isStage: false,
    name: "Sprite1",
    variables: {},
    lists: {},
    broadcasts: {},
    blocks: {},
    comments: {},
    currentCostume: 0,
    costumes: [costume()],
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
  };
  return {
    json: {
      targets: [stage, sprite],
      monitors: [],
      extensions: [],
      meta: {semver: "3.0.0", vm: "2.3.0", agent: "test"},
    },
    stage,
    sprite,
  };
}

async function zipUp(
  json: unknown,
  assets: Map<string, Uint8Array> = new Map([[`${SVG_ID}.svg`, SVG]]),
  prefix = "",
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(`${prefix}project.json`, JSON.stringify(json));
  for (const [name, data] of assets) zip.file(`${prefix}${name}`, data);
  return new Uint8Array(
    await zip.generateAsync({type: "uint8array", compression: "DEFLATE"}),
  );
}

describe("loadSb3 opens the projects children actually make", () => {
  it("opens a project with a variable watcher on the stage", async () => {
    const {json} = project();
    json.monitors = [
      {
        id: "m1",
        mode: "default",
        opcode: "data_variable",
        params: {VARIABLE: "score"},
        spriteName: null,
        value: 0,
        width: 0,
        height: 0,
        x: 5,
        y: 5,
        visible: true,
        sliderMin: 0,
        sliderMax: 100,
        isDiscrete: true,
      },
    ];

    const result = await loadSb3(await zipUp(json));

    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.warnings.join("\n")).toContain("monitor");
    expect(result.document?.monitors).toEqual([]);
  });

  it("opens a project with workspace comments and block comments", async () => {
    const {json, sprite} = project();
    sprite.comments = {
      c1: {
        blockId: null,
        x: 100,
        y: 100,
        width: 200,
        height: 200,
        minimized: false,
        text: "ここで動かす",
      },
    };
    sprite.blocks = {
      b1: {
        opcode: "motion_movesteps",
        next: null,
        parent: null,
        inputs: {STEPS: [1, [4, "10"]]},
        fields: {},
        shadow: false,
        topLevel: true,
        x: 0,
        y: 0,
        comment: "c1",
      },
    };

    const result = await loadSb3(await zipUp(json));

    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.warnings.join("\n")).toContain("comment");
  });

  it("drops fields it does not model instead of refusing the file", async () => {
    const {json, sprite} = project();
    sprite.customField = 1;
    json.customTopLevel = {};

    const result = await loadSb3(await zipUp(json));

    expect(result.ok).toBe(true);
    expect(result.warnings.join("\n")).toContain("customField");
    expect(result.warnings.join("\n")).toContain("customTopLevel");
  });

  it("keeps an asset whose bytes no longer hash to its id", async () => {
    const {json} = project();
    // Scratch does not re-hash a costume it re-serializes, so genuine files
    // ship assets named after an earlier version of their own bytes.
    const edited = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="3" height="3"></svg>',
    );

    const result = await loadSb3(
      await zipUp(json, new Map([[`${SVG_ID}.svg`, edited]])),
    );

    expect(result.ok).toBe(true);
    expect(result.warnings.join("\n")).toContain("!= assetId");
    expect(result.assets?.get(`${SVG_ID}.svg`)).toEqual(edited);
  });

  it("detaches argument reporters left behind by a custom block edit", async () => {
    const {json, sprite} = project();
    sprite.blocks = {
      orphan: {
        opcode: "argument_reporter_string_number",
        next: null,
        parent: "prototype-that-was-deleted",
        inputs: {},
        fields: {VALUE: ["time", null]},
        shadow: false,
        topLevel: false,
      },
    };

    const result = await loadSb3(await zipUp(json));

    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.warnings.join("\n")).toContain("orphaned block");
    const block = result.document?.targets[1]?.blocks.orphan;
    expect(block && !Array.isArray(block) ? block.parent : "unset").toBeNull();
  });

  it("accepts the boolean warp and absent call warp that Scratch writes", async () => {
    const {json, sprite} = project();
    sprite.blocks = {
      def: {
        opcode: "procedures_definition",
        next: null,
        parent: null,
        inputs: {custom_block: [1, "proto"]},
        fields: {},
        shadow: false,
        topLevel: true,
        x: 0,
        y: 0,
      },
      proto: {
        opcode: "procedures_prototype",
        next: null,
        parent: "def",
        inputs: {},
        fields: {},
        shadow: true,
        topLevel: false,
        mutation: {
          tagName: "mutation",
          children: [],
          proccode: "じゃんぷ",
          argumentids: "[]",
          argumentnames: "[]",
          argumentdefaults: "[]",
          warp: true,
        },
      },
      call: {
        opcode: "procedures_call",
        next: null,
        parent: null,
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: true,
        x: 0,
        y: 200,
        mutation: {
          tagName: "mutation",
          children: [],
          proccode: "じゃんぷ",
          argumentids: "[]",
        },
      },
    };

    const result = await loadSb3(await zipUp(json));

    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("accepts an obscured input whose shadow slot is null", async () => {
    const {json, sprite} = project();
    sprite.blocks = {
      wrap: {
        opcode: "control_if",
        next: null,
        parent: null,
        inputs: {CONDITION: [3, "cond", null]},
        fields: {},
        shadow: false,
        topLevel: true,
        x: 0,
        y: 0,
      },
      cond: {
        opcode: "sensing_mousedown",
        next: null,
        parent: "wrap",
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: false,
      },
    };

    const result = await loadSb3(await zipUp(json));

    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe("loadSb3 and archives that were unzipped and zipped again", () => {
  it("finds project.json under a single wrapper directory", async () => {
    const {json} = project();

    const result = await loadSb3(await zipUp(json, undefined, "my project/"));

    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    // Assets must be keyed relative to the root or md5ext lookups miss.
    expect(result.assets?.has(`${SVG_ID}.svg`)).toBe(true);
    expect(result.warnings.join("\n")).toContain("my project/");
  });

  it("ignores the resource forks macOS adds when compressing a folder", async () => {
    const {json} = project();
    const zip = new JSZip();
    zip.file("my project/project.json", JSON.stringify(json));
    zip.file(`my project/${SVG_ID}.svg`, SVG);
    zip.file("__MACOSX/._my project", new Uint8Array([0, 5, 22]));
    zip.file(`__MACOSX/my project/._${SVG_ID}.svg`, new Uint8Array([0, 5, 22]));
    zip.file("my project/.DS_Store", new Uint8Array([0, 1]));

    const result = await loadSb3(
      new Uint8Array(await zip.generateAsync({type: "uint8array"})),
    );

    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("refuses to guess a root when the archive holds two projects", () => {
    expect(
      findProjectRootPrefix(["a/project.json", "b/project.json"]),
    ).toBeNull();
  });

  it("refuses to strip a directory that does not contain everything", () => {
    expect(
      findProjectRootPrefix(["a/project.json", "elsewhere/cat.svg"]),
    ).toBeNull();
  });

  it("reports no root when there is no project.json at all", () => {
    expect(findProjectRootPrefix(["cat.svg", "notes.txt"])).toBeNull();
  });

  it("accepts the wrapper's own directory entry, slash or no slash", () => {
    expect(
      findProjectRootPrefix(["my project", "my project/project.json"]),
    ).toBe("my project/");
    expect(
      findProjectRootPrefix(["my project/", "my project/project.json"]),
    ).toBe("my project/");
  });
});

describe("loadSb3 still refuses what is actually dangerous", () => {
  it("rejects an upload past the size cap", async () => {
    const oversize = new Uint8Array(DEFAULT_LIMITS.maxBytes + 1);

    const result = await loadSb3(oversize);

    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("TOO_LARGE");
  });

  it("rejects a path that escapes the archive root", async () => {
    const {json} = project();
    const zip = new JSZip();
    zip.file("project.json", JSON.stringify(json));
    zip.file(`${SVG_ID}.svg`, SVG);
    zip.file("../escape.svg", SVG);

    const result = await loadSb3(
      new Uint8Array(await zip.generateAsync({type: "uint8array"})),
    );

    expect(result.ok).toBe(false);
    // JSZip resolves the entry name before we see it, so an escape arrives as
    // either shape; both are unsafe-path rejections.
    expect(result.issues.map(i => i.code)).toSatisfy((codes: string[]) =>
      codes.includes("PATH_TRAVERSAL") || codes.includes("ABSOLUTE_PATH"),
    );
  });

  it("rejects an archive that inflates far past its own size", async () => {
    const zip = new JSZip();
    zip.file("project.json", "{}");
    zip.file("bomb", new Uint8Array(40 * 1024 * 1024));

    const result = await loadSb3(
      new Uint8Array(
        await zip.generateAsync({type: "uint8array", compression: "DEFLATE"}),
      ),
    );

    expect(result.ok).toBe(false);
    expect(result.issues[0]?.code).toBe("RATIO_EXCEEDED");
  });

  it("still reports a costume whose bytes are missing", async () => {
    const {json} = project();

    const result = await loadSb3(await zipUp(json, new Map()));

    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.code)).toContain("MISSING_ASSET");
  });
});
