import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BlockMapEntry, ScratchBlock } from "@blocksync/project-schema";
import { isPrimitiveBlockEntry, isScratchBlock } from "@blocksync/project-schema";
import { customProcedureFixtureDocument } from "@blocksync/project-envelope";
import {
  equivalenceProduction,
  EquivalenceGraphError,
  exportSb3,
  loadSb3,
  projectJsonToDocument,
  documentToProjectJson,
  scriptFingerprint,
  scriptRootFingerprints,
  stableJson,
  assertSafeSvgBytes,
  SvgSafetyError,
  assertValidRasterBytes,
  RasterVerifyError,
  assertValidMp3Bytes,
  parsePngDimensions,
  parseGifDimensions,
  parseBmpDimensions,
  parseJpegDimensions,
} from "../src/index.js";
import {
  audioCorpusAssetBundle,
  buildAudioCorpusProjectJson,
  md5Hex,
  minimalPngBytes,
  TEST_CAT_SVG,
  zipFromProject,
} from "./helpers/assets.js";

const fixtureDir = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/svg",
);

function renameBlockGraph(
  blocks: Record<string, BlockMapEntry>,
  idMap: Record<string, string>,
): Record<string, BlockMapEntry> {
  const remapRef = (value: unknown): unknown => {
    if (typeof value === "string" && idMap[value]) return idMap[value];
    if (Array.isArray(value)) return value.map(remapRef);
    return value;
  };

  const out: Record<string, BlockMapEntry> = {};
  for (const [oldId, b] of Object.entries(blocks)) {
    if (Array.isArray(b)) {
      out[idMap[oldId] ?? oldId] = b;
      continue;
    }
    const newId = idMap[oldId] ?? oldId;
    const inputs: Record<string, unknown> = {};
    for (const [slot, inp] of Object.entries(b.inputs ?? {})) {
      inputs[slot] = remapRef(inp);
    }
    out[newId] = {
      ...b,
      id: newId,
      next: b.next ? (idMap[b.next] ?? b.next) : null,
      parent: b.parent ? (idMap[b.parent] ?? b.parent) : null,
      inputs,
    };
  }
  return out;
}

describe("equivalenceProduction (§6.7)", () => {
  it("treats UID-regenerated custom procedure graphs as equivalent", () => {
    const base = customProcedureFixtureDocument();
    const sprite = base.targets.find((t) => !t.isStage)!;
    const renamed = renameBlockGraph(sprite.blocks, {
      define_id: "def2",
      proto_id: "pr2",
      attached_id: "at2",
    });

    const docA = structuredClone(base);
    const docB = structuredClone(base);
    docB.targets.find((t) => !t.isStage)!.blocks = renamed;

    expect(equivalenceProduction(docA, docB)).toBe(true);
  });

  it("returns false when mutation changes", () => {
    const base = customProcedureFixtureDocument();
    const changed = structuredClone(base);
    const sprite = changed.targets.find((t) => !t.isStage)!;
    const proto = sprite.blocks.proto_id;
    if (!isScratchBlock(proto)) throw new Error("expected object block");
    proto.mutation = {
      ...proto.mutation!,
      proccode: "other %s",
    };
    expect(equivalenceProduction(base, changed)).toBe(false);
  });

  it("preserves multiset counts for duplicate top-level stacks", () => {
    const blocks: Record<string, ScratchBlock> = {
      a1: {
        id: "a1",
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
        id: "m1",
        opcode: "motion_movesteps",
        next: null,
        parent: "a1",
        inputs: { STEPS: [1, [4, "1"]] },
        fields: {},
        topLevel: false,
      },
      a2: {
        id: "a2",
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
        id: "m2",
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

  it("throws on cycle", () => {
    const blocks: Record<string, ScratchBlock> = {
      a: {
        id: "a",
        opcode: "event_whenflagclicked",
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
    };
    expect(() => scriptFingerprint(blocks, "a")).toThrow(EquivalenceGraphError);
  });

  it("uses stableJson for deterministic output", () => {
    expect(stableJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it("detects costume order changes (ordered comparison)", () => {
    const catSvg = new TextEncoder().encode(TEST_CAT_SVG);
    const catId = md5Hex(catSvg);
    const otherSvg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/></svg>',
    );
    const otherId = md5Hex(otherSvg);
    const base = customProcedureFixtureDocument();
    const sprite = base.targets.find((t) => !t.isStage)!;
    sprite.costumes = [
      {
        kind: "costume",
        name: "first",
        assetId: catId,
        md5ext: `${catId}.svg`,
        dataFormat: "svg",
        contentSha256: "a".repeat(64),
        rotationCenterX: 48,
        rotationCenterY: 50,
      },
      {
        kind: "costume",
        name: "second",
        assetId: otherId,
        md5ext: `${otherId}.svg`,
        dataFormat: "svg",
        contentSha256: "b".repeat(64),
        rotationCenterX: 48,
        rotationCenterY: 50,
      },
    ];
    sprite.currentCostume = 0;
    const swapped = structuredClone(base);
    const swappedSprite = swapped.targets.find((t) => !t.isStage)!;
    swappedSprite.costumes = [...(sprite.costumes ?? [])].reverse();
    swappedSprite.currentCostume = 0;
    expect(equivalenceProduction(base, swapped)).toBe(false);
  });

  it("ignores top-level x/y in script fingerprints (§6.7)", () => {
    const blocks: Record<string, ScratchBlock> = {
      hat: {
        id: "hat",
        opcode: "event_whenflagclicked",
        next: null,
        parent: null,
        inputs: {},
        fields: {},
        topLevel: true,
        x: 10,
        y: 20,
      },
    };
    const moved: Record<string, ScratchBlock> = {
      hat: { ...blocks.hat, x: 99, y: 88 },
    };
    expect(scriptFingerprint(blocks, "hat")).toBe(
      scriptFingerprint(moved, "hat"),
    );
  });

  it("includes top-level variable primitives in multiset fingerprints", () => {
    const blocksA: Record<string, BlockMapEntry> = {
      var1: [12, "score", "id-a", 0, 0],
    };
    const blocksB: Record<string, BlockMapEntry> = {
      var2: [12, "score", "id-a", 50, 60],
    };
    expect(scriptRootFingerprints(blocksA)).toEqual(
      scriptRootFingerprints(blocksB),
    );

    const blocksC: Record<string, BlockMapEntry> = {
      var1: [12, "lives", "id-a", 0, 0],
    };
    expect(scriptRootFingerprints(blocksA)).not.toEqual(
      scriptRootFingerprints(blocksC),
    );
  });

  it("detects top-level primitive count changes", () => {
    const base = customProcedureFixtureDocument();
    const withVar = structuredClone(base);
    withVar.targets.find((t) => !t.isStage)!.blocks = {
      v1: [12, "score", "var-a", 0, 0],
    };
    const withTwo = structuredClone(withVar);
    withTwo.targets.find((t) => !t.isStage)!.blocks = {
      v1: [12, "score", "var-a", 0, 0],
      v2: [12, "lives", "var-b", 0, 0],
    };
    expect(equivalenceProduction(withVar, withTwo)).toBe(false);
  });

  it("detects meta changes", () => {
    const base = customProcedureFixtureDocument();
    const changed = structuredClone(base);
    changed.meta = { ...(changed.meta ?? {}), note: "changed" };
    expect(equivalenceProduction(base, changed)).toBe(false);
  });

  it("detects costume name changes", () => {
    const base = customProcedureFixtureDocument();
    const changed = structuredClone(base);
    changed.targets.find((t) => !t.isStage)!.costumes![0]!.name = "renamed";
    expect(equivalenceProduction(base, changed)).toBe(false);
  });
});

describe("canonical SB3 I/O", () => {
  it("rejects motion_unknown via opcode allow-list", async () => {
    const cat = new TextEncoder().encode(TEST_CAT_SVG);
    const catId = md5Hex(cat);
    const projectJson = {
      targets: [
        {
          isStage: true,
          name: "Stage",
          variables: {},
          lists: {},
          broadcasts: {},
          blocks: {},
          comments: {},
          currentCostume: 0,
          costumes: [
            {
              name: "backdrop1",
              dataFormat: "svg",
              assetId: catId,
              md5ext: `${catId}.svg`,
              rotationCenterX: 240,
              rotationCenterY: 180,
            },
          ],
          sounds: [],
          volume: 100,
          layerOrder: 0,
          tempo: 60,
          videoTransparency: 50,
          videoState: "on",
          textToSpeechLanguage: null,
        },
        {
          isStage: false,
          name: "Sprite1",
          variables: {},
          lists: {},
          broadcasts: {},
          blocks: {
            b1: {
              opcode: "motion_unknown",
              next: null,
              parent: null,
              inputs: {},
              fields: {},
              topLevel: true,
              x: 0,
              y: 0,
            },
          },
          comments: {},
          currentCostume: 0,
          costumes: [
            {
              name: "costume1",
              dataFormat: "svg",
              assetId: catId,
              md5ext: `${catId}.svg`,
              rotationCenterX: 48,
              rotationCenterY: 50,
            },
          ],
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
        },
      ],
      monitors: [],
      extensions: [],
    };
    const assets = new Map([[`${catId}.svg`, cat]]);
    const bytes = await zipFromProject(projectJson, assets);
    const loaded = await loadSb3(bytes);
    expect(loaded.ok).toBe(false);
    expect(
      loaded.issues.some(
        (i) =>
          i.code === "SCHEMA_INVALID" &&
          i.message.includes("UNKNOWN_OPCODE"),
      ),
    ).toBe(true);
  });

  it("verifies audio corpus rate/sampleCount (pop 44100/1032, Meow 44100/37376)", async () => {
    const projectJson = buildAudioCorpusProjectJson();
    const assets = audioCorpusAssetBundle(projectJson);
    const bytes = await zipFromProject(projectJson, assets);
    const loaded = await loadSb3(bytes);
    expect(loaded.ok).toBe(true);
    expect(loaded.document!.schemaVersion).toBe(2);

    const stage = loaded.document!.targets.find((t) => t.isStage)!;
    const sprite = loaded.document!.targets.find((t) => !t.isStage)!;
    expect(stage.sounds![0]).toMatchObject({
      name: "pop",
      rate: 44100,
      sampleCount: 1032,
    });
    expect(sprite.sounds![0]).toMatchObject({
      name: "Meow",
      rate: 44100,
      sampleCount: 37376,
    });

    const exported = await exportSb3(loaded.document!, assets);
    const reloaded = await loadSb3(exported);
    expect(reloaded.ok).toBe(true);
    expect(equivalenceProduction(loaded.document!, reloaded.document!)).toBe(
      true,
    );
  });

  it("preserves custom procedure mutation on export → re-import", async () => {
    const catSvg = new TextEncoder().encode(TEST_CAT_SVG);
    const catId = md5Hex(catSvg);
    const projectJson = {
      targets: [
        {
          isStage: true,
          name: "Stage",
          variables: {},
          lists: {},
          broadcasts: {},
          blocks: {},
          comments: {},
          currentCostume: 0,
          costumes: [
            {
              name: "backdrop1",
              dataFormat: "svg",
              assetId: catId,
              md5ext: `${catId}.svg`,
              rotationCenterX: 240,
              rotationCenterY: 180,
            },
          ],
          sounds: [],
          volume: 100,
          layerOrder: 0,
          tempo: 60,
          videoTransparency: 50,
          videoState: "on",
          textToSpeechLanguage: null,
        },
        {
          isStage: false,
          name: "Sprite1",
          variables: {},
          lists: {},
          broadcasts: {},
          blocks: {
            define_id: {
              opcode: "procedures_definition",
              next: "attached_id",
              parent: null,
              inputs: { custom_block: [2, "proto_id"] },
              fields: {},
              shadow: false,
              topLevel: true,
              x: 0,
              y: 0,
            },
            proto_id: {
              opcode: "procedures_prototype",
              next: null,
              parent: "define_id",
              inputs: {},
              fields: {},
              shadow: false,
              topLevel: false,
              mutation: {
                tagName: "mutation",
                children: [],
                proccode: "my block %s",
                argumentids: '["arg_id"]',
                argumentnames: '["x"]',
                argumentdefaults: '[""]',
                warp: "false",
              },
            },
            attached_id: {
              opcode: "motion_movesteps",
              next: null,
              parent: "define_id",
              inputs: { STEPS: [1, [4, "10"]] },
              fields: {},
              shadow: false,
              topLevel: false,
            },
          },
          comments: {},
          currentCostume: 0,
          costumes: [
            {
              name: "costume1",
              dataFormat: "svg",
              assetId: catId,
              md5ext: `${catId}.svg`,
              rotationCenterX: 48,
              rotationCenterY: 50,
            },
          ],
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
        },
      ],
      monitors: [],
      extensions: [],
    };
    const assets = new Map([[`${catId}.svg`, catSvg]]);
    const bytes = await zipFromProject(projectJson, assets);
    const loaded = await loadSb3(bytes);
    expect(loaded.ok).toBe(true);

    const sprite = loaded.document!.targets.find((t) => !t.isStage)!;
    const protoEntry = sprite.blocks.proto_id;
    if (!isScratchBlock(protoEntry)) throw new Error("expected object block");
    const origProto = protoEntry.mutation!;
    const exported = await exportSb3(loaded.document!, assets);
    const reloaded = await loadSb3(exported);
    expect(reloaded.ok).toBe(true);

    const reSprite = reloaded.document!.targets.find((t) => !t.isStage)!;
    const reProtoEntry = reSprite.blocks.proto_id;
    if (!isScratchBlock(reProtoEntry)) throw new Error("expected object block");
    const reProto = reProtoEntry.mutation!;
    expect(reProto).toEqual(origProto);
    expect(
      equivalenceProduction(loaded.document!, reloaded.document!),
    ).toBe(true);
  });

  it("preserves old-format procedure call and argument reporter on round-trip", async () => {
    const catSvg = new TextEncoder().encode(TEST_CAT_SVG);
    const catId = md5Hex(catSvg);
    const projectJson = {
      targets: [
        {
          isStage: true,
          name: "Stage",
          variables: {},
          lists: {},
          broadcasts: {},
          blocks: {},
          comments: {},
          currentCostume: 0,
          costumes: [
            {
              name: "backdrop1",
              dataFormat: "svg",
              assetId: catId,
              md5ext: `${catId}.svg`,
              rotationCenterX: 240,
              rotationCenterY: 180,
            },
          ],
          sounds: [],
          volume: 100,
          layerOrder: 0,
          tempo: 60,
          videoTransparency: 50,
          videoState: "on",
          textToSpeechLanguage: null,
        },
        {
          isStage: false,
          name: "Sprite1",
          variables: {},
          lists: {},
          broadcasts: {},
          blocks: {
            flag_id: {
              opcode: "event_whenflagclicked",
              next: "call_id",
              parent: null,
              inputs: {},
              fields: {},
              shadow: false,
              topLevel: true,
              x: 0,
              y: 0,
            },
            call_id: {
              opcode: "procedures_call",
              next: null,
              parent: "flag_id",
              inputs: { input0: [1, [4, "10"]] },
              fields: {},
              shadow: false,
              topLevel: false,
              mutation: {
                tagName: "mutation",
                children: [],
                proccode: "my block %s",
                argumentids: '["input0"]',
                warp: "false",
              },
            },
            define_id: {
              opcode: "procedures_definition",
              next: "attached_id",
              parent: null,
              inputs: { custom_block: [1, "proto_id"] },
              fields: {},
              shadow: false,
              topLevel: true,
              x: 0,
              y: 100,
            },
            proto_id: {
              opcode: "procedures_prototype",
              next: null,
              parent: "define_id",
              inputs: { arg_id: [1, "reporter_id"] },
              fields: {},
              shadow: true,
              topLevel: false,
              mutation: {
                tagName: "mutation",
                children: [],
                proccode: "my block %s",
                argumentids: '["arg_id"]',
                argumentnames: '["x"]',
                argumentdefaults: '[""]',
                warp: "false",
              },
            },
            reporter_id: {
              opcode: "argument_reporter_string_number",
              next: null,
              parent: "proto_id",
              inputs: {},
              fields: { VALUE: ["x", null] },
              shadow: true,
              topLevel: false,
            },
            attached_id: {
              opcode: "motion_movesteps",
              next: null,
              parent: "define_id",
              inputs: { STEPS: [1, [4, "10"]] },
              fields: {},
              shadow: false,
              topLevel: false,
            },
          },
          comments: {},
          currentCostume: 0,
          costumes: [
            {
              name: "costume1",
              dataFormat: "svg",
              assetId: catId,
              md5ext: `${catId}.svg`,
              rotationCenterX: 48,
              rotationCenterY: 50,
            },
          ],
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
        },
      ],
      monitors: [],
      extensions: [],
    };
    const assets = new Map([[`${catId}.svg`, catSvg]]);
    const loaded = await loadSb3(await zipFromProject(projectJson, assets));
    expect(loaded.ok).toBe(true);
    const exported = await exportSb3(loaded.document!, assets);
    const reloaded = await loadSb3(exported);
    expect(reloaded.ok).toBe(true);
    expect(
      equivalenceProduction(loaded.document!, reloaded.document!),
    ).toBe(true);
  });

  it("normalizes jpeg md5ext suffix to jpg on import", async () => {
    const jpegBytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01,
      0x01, 0x00, 0x00, 0xff, 0xd9,
    ]);
    const assetId = md5Hex(jpegBytes);
    const projectJson = {
      targets: [
        {
          isStage: true,
          name: "Stage",
          variables: {},
          lists: {},
          broadcasts: {},
          blocks: {},
          comments: {},
          currentCostume: 0,
          costumes: [
            {
              name: "backdrop1",
              dataFormat: "jpg",
              assetId,
              md5ext: `${assetId}.jpeg`,
              rotationCenterX: 0,
              rotationCenterY: 0,
            },
          ],
          sounds: [],
          volume: 100,
          layerOrder: 0,
          tempo: 60,
          videoTransparency: 50,
          videoState: "on",
          textToSpeechLanguage: null,
        },
      ],
      monitors: [],
      extensions: [],
    };
    const loaded = await loadSb3(
      await zipFromProject(
        projectJson,
        new Map([[`${assetId}.jpeg`, jpegBytes]]),
      ),
    );
    expect(loaded.ok).toBe(true);
    expect(loaded.document!.targets[0]!.costumes![0]!.md5ext).toBe(
      `${assetId}.jpg`,
    );
    expect(loaded.document!.targets[0]!.costumes![0]!.dataFormat).toBe("jpg");
  });

  it("rejects SVG fuzz fixtures via explicit DOM walk", () => {
    const files = readdirSync(fixtureDir).filter((f) => f.endsWith(".svg"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const bytes = readFileSync(join(fixtureDir, file));
      expect(() => assertSafeSvgBytes(bytes)).toThrow(SvgSafetyError);
    }
  });

  it("accepts safe minimal SVG", () => {
    const bytes = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect width="2" height="2"/></svg>',
    );
    expect(() => assertSafeSvgBytes(bytes)).not.toThrow();
  });

  it("projectJsonToDocument assigns schemaVersion 2", () => {
    const projectJson = buildAudioCorpusProjectJson();
    const { _assetIds: _, ...clean } = projectJson;
    const doc = projectJsonToDocument(clean);
    expect(doc.schemaVersion).toBe(2);
    expect(doc.monitors).toEqual([]);
    expect(doc.targets[0]!.comments).toEqual({});
  });

  it("rejects PNG wider than 4096px", () => {
    expect(() => assertValidRasterBytes(minimalPngBytes(5000, 100), "png")).toThrow(
      RasterVerifyError,
    );
    expect(() => parsePngDimensions(minimalPngBytes(5000, 100))).toThrow(
      RasterVerifyError,
    );
  });

  it("preserves primitive block map entries on import/export", async () => {
    const catSvg = new TextEncoder().encode(TEST_CAT_SVG);
    const catId = md5Hex(catSvg);
    const projectJson = {
      targets: [
        {
          isStage: true,
          name: "Stage",
          variables: {},
          lists: {},
          broadcasts: {},
          blocks: {},
          comments: {},
          currentCostume: 0,
          costumes: [
            {
              name: "backdrop1",
              dataFormat: "svg",
              assetId: catId,
              md5ext: `${catId}.svg`,
              rotationCenterX: 240,
              rotationCenterY: 180,
            },
          ],
          sounds: [],
          volume: 100,
          layerOrder: 0,
          tempo: 60,
          videoTransparency: 50,
          videoState: "on",
          textToSpeechLanguage: null,
        },
        {
          isStage: false,
          name: "Sprite1",
          variables: {},
          lists: {},
          broadcasts: {},
          blocks: {
            hat: {
              opcode: "event_whenflagclicked",
              next: "move",
              parent: null,
              inputs: {},
              fields: {},
              topLevel: true,
              x: 12,
              y: 34,
            },
            shadow_num: [4, "5"],
            move: {
              opcode: "motion_movesteps",
              next: null,
              parent: "hat",
              inputs: { STEPS: [1, "shadow_num"] },
              fields: {},
              topLevel: false,
            },
          },
          comments: {},
          currentCostume: 0,
          costumes: [
            {
              name: "costume1",
              dataFormat: "svg",
              assetId: catId,
              md5ext: `${catId}.svg`,
              rotationCenterX: 48,
              rotationCenterY: 50,
            },
          ],
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
        },
      ],
      monitors: [],
      extensions: [],
    };
    const assets = new Map([[`${catId}.svg`, catSvg]]);
    const loaded = await loadSb3(await zipFromProject(projectJson, assets));
    expect(loaded.ok).toBe(true);
    expect(Array.isArray(loaded.document!.targets[1]!.blocks.shadow_num)).toBe(
      true,
    );
    expect(loaded.document!.targets[1]!.blocks.hat).toMatchObject({
      x: 12,
      y: 34,
    });

    const exported = documentToProjectJson(loaded.document!);
    const spriteBlocks = (
      exported.targets as Array<{ blocks: Record<string, unknown> }>
    )[1]!.blocks;
    expect(spriteBlocks.shadow_num).toEqual([4, "5"]);
    expect(spriteBlocks.hat).toMatchObject({ x: 12, y: 34 });
  });

  it("rejects truncated PNG, GIF, and JPEG headers", () => {
    const png24 = minimalPngBytes(100, 100).slice(0, 24);
    expect(() => parsePngDimensions(png24)).toThrow(RasterVerifyError);

    const gifHeader = new TextEncoder().encode("GIF89a");
    const gif12 = new Uint8Array(12);
    gif12.set(gifHeader, 0);
    gif12[6] = 10;
    gif12[8] = 10;
    gif12[10] = 0;
    expect(() => parseGifDimensions(gif12)).toThrow(RasterVerifyError);

    const jpegShort = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x07, 0x08, 0x00, 0x01, 0x01, 0x01,
    ]);
    expect(() => parseJpegDimensions(jpegShort)).toThrow(RasterVerifyError);
  });

  it("accepts top-down BMP with signed negative height", () => {
    const buf = new ArrayBuffer(54);
    const view = new DataView(buf);
    view.setUint8(0, 0x42);
    view.setUint8(1, 0x4d);
    view.setUint32(2, 54, true);
    view.setUint32(10, 54, true);
    view.setUint32(14, 40, true);
    view.setInt32(18, 4, true);
    view.setInt32(22, -4, true);
    view.setUint16(26, 1, true);
    view.setUint16(28, 24, true);
    expect(parseBmpDimensions(new Uint8Array(buf))).toEqual({
      width: 4,
      height: 4,
    });
  });

  it("accepts vendor project1 cat costume SVG (fill-rule)", async () => {
    const JSZip = (await import("jszip")).default;
    const sb3Path = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../vendor/scratch-editor/packages/scratch-gui/test/fixtures/project1.sb3",
    );
    const zip = await JSZip.loadAsync(readFileSync(sb3Path));
    const catFiles = Object.keys(zip.files).filter(
      (name) => name.endsWith(".svg") && name !== "cd21514d0531fdffb22204e0ec5ed84a.svg",
    );
    expect(catFiles.length).toBeGreaterThan(0);
    for (const name of catFiles) {
      const bytes = new Uint8Array(await zip.file(name)!.async("arraybuffer"));
      expect(() => assertSafeSvgBytes(bytes)).not.toThrow();
    }
  });

  it("accepts referenced vendor SVG corpus from non-corrupt SB3 fixtures", async () => {
    const JSZip = (await import("jszip")).default;
    const fixtureRoots = [
      join(dirname(fileURLToPath(import.meta.url)), "../../../vendor/scratch-editor/packages/scratch-gui/test/fixtures"),
      join(dirname(fileURLToPath(import.meta.url)), "../../../vendor/scratch-editor/packages/scratch-vm/test/fixtures"),
      join(dirname(fileURLToPath(import.meta.url)), "../../../vendor/scratch-editor/packages/scratch-render/test/integration/scratch-tests"),
    ];
    const skip = /corrupt|invalid|missing_/i;
    let checked = 0;
    for (const root of fixtureRoots) {
      for (const name of readdirSync(root)) {
        if (!name.endsWith(".sb3") || skip.test(name)) continue;
        const zip = await JSZip.loadAsync(readFileSync(join(root, name)));
        const projectFile = zip.file("project.json");
        if (!projectFile) continue;
        const pj = JSON.parse(await projectFile.async("string"));
        const refs = new Set<string>();
        for (const t of pj.targets ?? []) {
          for (const c of t.costumes ?? []) {
            if (c.md5ext?.endsWith(".svg")) refs.add(c.md5ext);
          }
        }
        for (const md5ext of refs) {
          const bytes = new Uint8Array(
            await zip.file(md5ext)!.async("arraybuffer"),
          );
          expect(() => assertSafeSvgBytes(bytes)).not.toThrow();
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  it("accepts vendor draggable.sb3 costume SVG (root x/y, enable-background)", async () => {
    const JSZip = (await import("jszip")).default;
    const sb3Path = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../vendor/scratch-editor/packages/scratch-vm/test/fixtures/draggable.sb3",
    );
    const zip = await JSZip.loadAsync(readFileSync(sb3Path));
    const pj = JSON.parse(await zip.file("project.json")!.async("string"));
    for (const t of pj.targets ?? []) {
      for (const c of t.costumes ?? []) {
        if (!c.md5ext?.endsWith(".svg")) continue;
        const bytes = new Uint8Array(
          await zip.file(c.md5ext)!.async("arraybuffer"),
        );
        expect(() => assertSafeSvgBytes(bytes)).not.toThrow();
      }
    }
  });

  it("rejects SB3 with missing referenced asset bytes (§2.3)", async () => {
    const sb3Path = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../vendor/scratch-editor/packages/scratch-vm/test/fixtures/missing_png.sb3",
    );
    const loaded = await loadSb3(readFileSync(sb3Path));
    expect(loaded.ok).toBe(false);
    expect(
      loaded.issues.some((i) => i.code === "MISSING_ASSET"),
    ).toBe(true);
  });

  it("loads vendor project1.sb3 with resampled WAV metadata", async () => {
    const sb3Path = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../vendor/scratch-editor/packages/scratch-gui/test/fixtures/project1.sb3",
    );
    const loaded = await loadSb3(readFileSync(sb3Path));
    expect(loaded.ok).toBe(true);
    const stage = loaded.document!.targets.find((t) => t.isStage)!;
    const pop = stage.sounds!.find((s) => s.name === "pop")!;
    expect(pop.rate).toBe(44100);
    expect(pop.sampleCount).toBe(1032);
  });

  it("accepts vendor scratch3_music MP3 corpus bytes", () => {
    const mp3Path = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../vendor/scratch-editor/packages/scratch-vm/src/extensions/scratch3_music/assets/drums/1-snare.mp3",
    );
    const bytes = readFileSync(mp3Path);
    expect(() => assertValidMp3Bytes(new Uint8Array(bytes))).not.toThrow();
  });

  it("rejects md5ext stem mismatch on import", async () => {
    const catSvg = new TextEncoder().encode(TEST_CAT_SVG);
    const catId = md5Hex(catSvg);
    const projectJson = {
      targets: [
        {
          isStage: true,
          name: "Stage",
          variables: {},
          lists: {},
          broadcasts: {},
          blocks: {},
          comments: {},
          currentCostume: 0,
          costumes: [
            {
              name: "backdrop1",
              dataFormat: "svg",
              assetId: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
              md5ext: `${catId}.svg`,
              rotationCenterX: 240,
              rotationCenterY: 180,
            },
          ],
          sounds: [],
          volume: 100,
          layerOrder: 0,
          tempo: 60,
          videoTransparency: 50,
          videoState: "on",
          textToSpeechLanguage: null,
        },
      ],
      monitors: [],
      extensions: [],
    };
    const loaded = await loadSb3(
      await zipFromProject(projectJson, new Map([[`${catId}.svg`, catSvg]])),
    );
    expect(loaded.ok).toBe(false);
    expect(
      loaded.issues.some(
        (i) =>
          i.code === "ASSET_REF_MISMATCH" ||
          (i.code === "SCHEMA_INVALID" &&
            i.message.includes("INVALID_ASSET_REF")),
      ),
    ).toBe(true);
  });

  it("validates primitive block entry arity per sb3.js", () => {
    expect(isPrimitiveBlockEntry([4, "10"])).toBe(true);
    expect(isPrimitiveBlockEntry([4])).toBe(false);
    expect(isPrimitiveBlockEntry([11, "msg", "id1"])).toBe(true);
    expect(isPrimitiveBlockEntry([12, "score", "var-id"])).toBe(true);
    expect(isPrimitiveBlockEntry([12, "score", "var-id", 0, 0])).toBe(true);
    expect(isPrimitiveBlockEntry([12, "score"])).toBe(false);
  });
});
