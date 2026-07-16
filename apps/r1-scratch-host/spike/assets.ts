import { createHash } from "node:crypto";

/** Deterministic minimal PCM WAV for spike tests. */
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

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function md5Hex(bytes: Uint8Array): string {
  return createHash("md5").update(bytes).digest("hex");
}

export const SPIKE_BACKDROP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"><rect width="480" height="360" fill="#e0e0ff"/></svg>`;

export const SPIKE_CAT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="100"><ellipse cx="48" cy="50" rx="40" ry="45" fill="#ffaa00"/></svg>`;

export function spikeAssetBundle(): Map<string, Uint8Array> {
  const backdrop = new TextEncoder().encode(SPIKE_BACKDROP_SVG);
  const cat = new TextEncoder().encode(SPIKE_CAT_SVG);
  const pop = minimalWavBytes({ sampleCount: 1032, rate: 44100 });
  const meow = minimalWavBytes({ sampleCount: 37376, rate: 44100 });
  const entries: Array<[string, Uint8Array]> = [
    [`${md5Hex(backdrop)}.svg`, backdrop],
    [`${md5Hex(cat)}.svg`, cat],
    [`${md5Hex(pop)}.wav`, pop],
    [`${md5Hex(meow)}.wav`, meow],
  ];
  return new Map(entries);
}
