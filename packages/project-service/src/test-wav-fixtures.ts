/** Shared WAV bytes for project-service tests. */
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

/** Minimal MPEG1 Layer III frames for project-service audio tests. */
export function minimalMp3FrameBytes(frameCount = 2): Uint8Array {
  const header = [0xff, 0xfb, 0x90, 0x00] as const;
  const frameLength = 417;
  const buf = new Uint8Array(frameLength * frameCount);
  for (let frame = 0; frame < frameCount; frame++) {
    buf.set(header, frame * frameLength);
  }
  return buf;
}

/** MPEG1 Layer II frames — must be rejected for .mp3 refs. */
export function minimalMpeg1Layer2FrameBytes(frameCount = 2): Uint8Array {
  const header = [0xff, 0xfc, 0x90, 0x00] as const;
  const frameLength = 417;
  const buf = new Uint8Array(frameLength * frameCount);
  for (let frame = 0; frame < frameCount; frame++) {
    buf.set(header, frame * frameLength);
  }
  return buf;
}
