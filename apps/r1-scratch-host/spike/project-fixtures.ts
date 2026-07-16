import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { md5Hex, SPIKE_CAT_SVG, SPIKE_BACKDROP_SVG, minimalWavBytes } from "./assets.js";

const spikeDir = dirname(fileURLToPath(import.meta.url));

export function buildCatWithSoundSb3(): Record<string, unknown> {
  const backdrop = new TextEncoder().encode(SPIKE_BACKDROP_SVG);
  const cat = new TextEncoder().encode(SPIKE_CAT_SVG);
  const pop = minimalWavBytes({ sampleCount: 1032 });
  const meow = minimalWavBytes({ sampleCount: 37376 });
  const backdropId = md5Hex(backdrop);
  const catId = md5Hex(cat);
  const popId = md5Hex(pop);
  const meowId = md5Hex(meow);

  return {
    targets: [
      {
        isStage: true,
        name: "Stage",
        variables: { "var:my variable": ["my variable", 0] },
        lists: {},
        broadcasts: {},
        blocks: {},
        comments: {},
        currentCostume: 0,
        costumes: [
          {
            name: "backdrop1",
            dataFormat: "svg",
            assetId: backdropId,
            md5ext: `${backdropId}.svg`,
            rotationCenterX: 240,
            rotationCenterY: 180,
          },
        ],
        sounds: [
          {
            name: "pop",
            assetId: popId,
            dataFormat: "wav",
            format: "",
            rate: 44100,
            sampleCount: 1032,
            md5ext: `${popId}.wav`,
          },
        ],
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
        blocks: {},
        comments: {},
        currentCostume: 0,
        costumes: [
          {
            name: "costume1",
            bitmapResolution: 1,
            dataFormat: "svg",
            assetId: catId,
            md5ext: `${catId}.svg`,
            rotationCenterX: 48,
            rotationCenterY: 50,
          },
        ],
        sounds: [
          {
            name: "Meow",
            assetId: meowId,
            dataFormat: "wav",
            format: "",
            rate: 44100,
            sampleCount: 37376,
            md5ext: `${meowId}.wav`,
          },
        ],
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
    meta: { semver: "3.0.0", vm: "14.1.0", agent: "r1-scratch-spike" },
  };
}

export function buildCustomProcedureSb3(): Record<string, unknown> {
  const cat = new TextEncoder().encode(SPIKE_CAT_SVG);
  const catId = md5Hex(cat);
  return {
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
    meta: { semver: "3.0.0", vm: "14.1.0", agent: "r1-scratch-spike" },
  };
}

export function loadFixtureJson(name: string): import("./schema/document-spike-v0.js").DocumentSpikeV0 {
  const raw = readFileSync(join(spikeDir, "fixtures", name), "utf8");
  return JSON.parse(raw) as import("./schema/document-spike-v0.js").DocumentSpikeV0;
}
