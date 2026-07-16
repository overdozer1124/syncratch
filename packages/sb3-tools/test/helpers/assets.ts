import { createHash } from "node:crypto";

export function md5Hex(bytes: Uint8Array): string {
  return createHash("md5").update(bytes).digest("hex");
}

/** Minimal PNG with valid signature + IHDR (for raster dimension tests). */
export function minimalPngBytes(width: number, height: number): Uint8Array {
  const out = new Uint8Array(33);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  out[8] = 0;
  out[9] = 0;
  out[10] = 0;
  out[11] = 13;
  out.set([0x49, 0x48, 0x44, 0x52], 12);
  out[16] = (width >>> 24) & 0xff;
  out[17] = (width >>> 16) & 0xff;
  out[18] = (width >>> 8) & 0xff;
  out[19] = width & 0xff;
  out[20] = (height >>> 24) & 0xff;
  out[21] = (height >>> 16) & 0xff;
  out[22] = (height >>> 8) & 0xff;
  out[23] = height & 0xff;
  out[24] = 8;
  out[25] = 2;
  return out;
}

export function minimalWavBytes(opts: {
  sampleCount: number;
  rate?: number;
  channels?: number;
}): Uint8Array {
  const rate = opts.rate ?? 44100;
  const channels = opts.channels ?? 1;
  const bits = 16;
  const dataBytes = opts.sampleCount * channels * (bits / 8);
  const buf = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, (rate * channels * bits) / 8, true);
  view.setUint16(32, (channels * bits) / 8, true);
  view.setUint16(34, bits, true);
  writeStr(36, "data");
  view.setUint32(40, dataBytes, true);
  return new Uint8Array(buf);
}

export const TEST_BACKDROP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#e0e0ff"/></svg>`;

export const TEST_CAT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="100"><ellipse cx="48" cy="50" rx="40" ry="45" fill="#ffaa00"/></svg>`;

export function buildAudioCorpusProjectJson(): Record<string, unknown> {
  const backdrop = new TextEncoder().encode(TEST_BACKDROP_SVG);
  const cat = new TextEncoder().encode(TEST_CAT_SVG);
  const pop = minimalWavBytes({ sampleCount: 1032, rate: 44100 });
  const meow = minimalWavBytes({ sampleCount: 37376, rate: 44100 });
  const backdropId = md5Hex(backdrop);
  const catId = md5Hex(cat);
  const popId = md5Hex(pop);
  const meowId = md5Hex(meow);

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
    meta: { semver: "3.0.0", vm: "14.1.0", agent: "sb3-tools-test" },
    _assetIds: { backdropId, catId, popId, meowId },
  };
}

export function audioCorpusAssetBundle(
  projectJson: Record<string, unknown>,
): Map<string, Uint8Array> {
  const ids = projectJson._assetIds as {
    backdropId: string;
    catId: string;
    popId: string;
    meowId: string;
  };
  const backdrop = new TextEncoder().encode(TEST_BACKDROP_SVG);
  const cat = new TextEncoder().encode(TEST_CAT_SVG);
  const pop = minimalWavBytes({ sampleCount: 1032, rate: 44100 });
  const meow = minimalWavBytes({ sampleCount: 37376, rate: 44100 });
  return new Map([
    [`${ids.backdropId}.svg`, backdrop],
    [`${ids.catId}.svg`, cat],
    [`${ids.popId}.wav`, pop],
    [`${ids.meowId}.wav`, meow],
  ]);
}

export async function zipFromProject(
  projectJson: Record<string, unknown>,
  assets: Map<string, Uint8Array>,
): Promise<Uint8Array> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const { _assetIds: _, ...clean } = projectJson;
  zip.file("project.json", JSON.stringify(clean));
  for (const [name, bytes] of assets) {
    zip.file(name, bytes);
  }
  return zip.generateAsync({ type: "uint8array" });
}
