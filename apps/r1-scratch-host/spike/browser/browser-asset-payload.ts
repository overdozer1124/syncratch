import { createHash } from "node:crypto";
import {
  SPIKE_BACKDROP_SVG,
  SPIKE_CAT_SVG,
  minimalWavBytes,
} from "../assets.js";

function md5Hex(bytes: Uint8Array): string {
  return createHash("md5").update(bytes).digest("hex");
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

/** Browser spike asset payload (same bytes as Node spike fixtures). */
export function browserAssetPayload(): {
  assets: Record<string, string>;
  catProject: Record<string, unknown>;
} {
  const backdrop = new TextEncoder().encode(SPIKE_BACKDROP_SVG);
  const cat = new TextEncoder().encode(SPIKE_CAT_SVG);
  const pop = minimalWavBytes({ sampleCount: 1032 });
  const meow = minimalWavBytes({ sampleCount: 37376 });
  const backdropId = md5Hex(backdrop);
  const catId = md5Hex(cat);
  const popId = md5Hex(pop);
  const meowId = md5Hex(meow);

  const assets: Record<string, string> = {
    [`${backdropId}.svg`]: toBase64(backdrop),
    [`${catId}.svg`]: toBase64(cat),
    [`${popId}.wav`]: toBase64(pop),
    [`${meowId}.wav`]: toBase64(meow),
  };

  const catProject = {
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
            assetId: backdropId,
            md5ext: `${backdropId}.svg`,
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
    meta: { semver: "3.0.0", vm: "14.1.0", agent: "r1-scratch-browser-spike" },
  };

  return { assets, catProject };
}

/** Detect orange cat pixels (#ffaa00) on stage canvas. */
export function sampleStageHasCatColor(imageData: Uint8ClampedArray): boolean {
  for (let i = 0; i < imageData.length; i += 4) {
    const r = imageData[i];
    const g = imageData[i + 1];
    const b = imageData[i + 2];
    const a = imageData[i + 3];
    if (a < 16) continue;
    if (r > 200 && g > 120 && g < 200 && b < 80) return true;
  }
  return false;
}
