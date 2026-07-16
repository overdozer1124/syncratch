/** MPEG-1/2 Layer III frame scan for import safety (Design §6.3). */

export class Mp3ParseError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "Mp3ParseError";
  }
}

export const MAX_MP3_SECONDS = 60;

const MPEG1_L3_BITRATE_KBPS = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
];
const MPEG2_L3_BITRATE_KBPS = [
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
];
const MPEG1_SAMPLE_RATE = [44100, 48000, 32000];
const MPEG2_SAMPLE_RATE = [22050, 24000, 16000];
const MPEG25_SAMPLE_RATE = [11025, 12000, 8000];

export interface ParsedMp3Audio {
  sampleRate: number;
  totalSamples: number;
  durationSeconds: number;
  frameCount: number;
}

function isMp3FrameSync(byte0: number, byte1: number): boolean {
  return byte0 === 0xff && (byte1 & 0xe0) === 0xe0;
}

function lookupBitrateKbps(version: number, bitrateIndex: number): number {
  return version === 0x03
    ? MPEG1_L3_BITRATE_KBPS[bitrateIndex]!
    : MPEG2_L3_BITRATE_KBPS[bitrateIndex]!;
}

function lookupSampleRate(version: number, sampleRateIndex: number): number {
  if (version === 0x03) return MPEG1_SAMPLE_RATE[sampleRateIndex]!;
  if (version === 0x02) return MPEG2_SAMPLE_RATE[sampleRateIndex]!;
  return MPEG25_SAMPLE_RATE[sampleRateIndex]!;
}

function samplesPerFrame(version: number): number {
  return version === 0x03 ? 1152 : 576;
}

function parseFrameHeader(
  bytes: Uint8Array,
  offset: number,
): { frameLength: number; sampleRate: number; samples: number } {
  if (offset + 4 > bytes.length) {
    throw new Mp3ParseError("MP3_FRAME_TRUNCATED");
  }
  const byte1 = bytes[offset + 1]!;
  const byte2 = bytes[offset + 2]!;
  const byte3 = bytes[offset + 3]!;
  if (!isMp3FrameSync(bytes[offset]!, byte1)) {
    throw new Mp3ParseError("MP3_FRAME_SYNC");
  }

  const version = (byte1 >> 3) & 0x03;
  const layer = (byte1 >> 1) & 0x03;
  if (version === 0x01) throw new Mp3ParseError("MP3_VERSION_RESERVED");
  if (layer === 0x00) throw new Mp3ParseError("MP3_LAYER_RESERVED");
  if (layer !== 0x01) throw new Mp3ParseError("MP3_LAYER_NOT_III");

  const bitrateIndex = (byte2 >> 4) & 0x0f;
  const sampleRateIndex = (byte2 >> 2) & 0x03;
  const padding = (byte2 >> 1) & 0x01;
  if (bitrateIndex === 0 || bitrateIndex === 0x0f) {
    throw new Mp3ParseError("MP3_BITRATE");
  }
  if (sampleRateIndex === 0x03) throw new Mp3ParseError("MP3_SAMPLE_RATE");
  if ((byte3 & 0x03) === 0x02) throw new Mp3ParseError("MP3_EMPHASIS");

  const bitrateKbps = lookupBitrateKbps(version, bitrateIndex);
  const sampleRate = lookupSampleRate(version, sampleRateIndex);
  const frameLength =
    version === 0x03
      ? Math.floor((144 * bitrateKbps * 1000) / sampleRate) + padding
      : Math.floor((72 * bitrateKbps * 1000) / sampleRate) + padding;

  if (frameLength < 4) throw new Mp3ParseError("MP3_FRAME_LENGTH");
  if (offset + frameLength > bytes.length) {
    throw new Mp3ParseError("MP3_FRAME_BOUNDARY");
  }

  return { frameLength, sampleRate, samples: samplesPerFrame(version) };
}

function readSynchsafeSize(bytes: Uint8Array, offset: number): number {
  for (let i = 0; i < 4; i++) {
    const byte = bytes[offset + i]!;
    if (byte & 0x80) {
      throw new Mp3ParseError("ID3_SYNCHSAFE");
    }
  }
  return (
    ((bytes[offset]! & 0x7f) << 21) |
    ((bytes[offset + 1]! & 0x7f) << 14) |
    ((bytes[offset + 2]! & 0x7f) << 7) |
    (bytes[offset + 3]! & 0x7f)
  );
}

function skipId3v2Tag(bytes: Uint8Array): number {
  if (bytes.length < 10) return 0;
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return 0;

  const major = bytes[3]!;
  const minor = bytes[4]!;
  const flags = bytes[5]!;
  const tagSize = readSynchsafeSize(bytes, 6);
  const bodyEnd = 10 + tagSize;
  if (bodyEnd > bytes.length) {
    throw new Mp3ParseError("ID3_TRUNCATED");
  }

  if (flags & 0x10) {
    if (major !== 4) {
      throw new Mp3ParseError("ID3_FOOTER_VERSION");
    }
    const footerStart = bodyEnd;
    if (footerStart + 10 > bytes.length) {
      throw new Mp3ParseError("ID3_FOOTER");
    }
    if (
      bytes[footerStart] !== 0x33 ||
      bytes[footerStart + 1] !== 0x44 ||
      bytes[footerStart + 2] !== 0x49
    ) {
      throw new Mp3ParseError("ID3_FOOTER");
    }
    if (
      bytes[footerStart + 3] !== major ||
      bytes[footerStart + 4] !== minor ||
      bytes[footerStart + 5] !== flags
    ) {
      throw new Mp3ParseError("ID3_FOOTER");
    }
    const footerSize = readSynchsafeSize(bytes, footerStart + 6);
    if (footerSize !== tagSize) {
      throw new Mp3ParseError("ID3_FOOTER");
    }
    return bodyEnd + 10;
  }

  return bodyEnd;
}

function id3v1TagStart(bytes: Uint8Array): number | null {
  if (bytes.length < 128) return null;
  const start = bytes.length - 128;
  if (
    bytes[start] === 0x54 &&
    bytes[start + 1] === 0x41 &&
    bytes[start + 2] === 0x47
  ) {
    return start;
  }
  return null;
}

/** Scan all MPEG Layer III frames and compute actual audio duration. */
export function parseMp3Audio(bytes: Uint8Array): ParsedMp3Audio {
  if (bytes.length < 4) throw new Mp3ParseError("MP3_TOO_SHORT");

  let offset = skipId3v2Tag(bytes);
  if (offset >= bytes.length) throw new Mp3ParseError("MP3_NO_FRAME_SYNC");

  const audioEnd = id3v1TagStart(bytes) ?? bytes.length;
  if (offset >= audioEnd) throw new Mp3ParseError("MP3_NO_FRAME_SYNC");

  let totalSamples = 0;
  let sampleRate: number | null = null;
  let frameCount = 0;

  while (offset + 4 <= audioEnd) {
    if (!isMp3FrameSync(bytes[offset]!, bytes[offset + 1]!)) {
      throw new Mp3ParseError("MP3_GARBAGE");
    }
    const header = parseFrameHeader(bytes, offset);
    if (sampleRate == null) sampleRate = header.sampleRate;
    else if (header.sampleRate !== sampleRate) {
      throw new Mp3ParseError("MP3_SAMPLE_RATE_CHANGE");
    }
    totalSamples += header.samples;
    offset += header.frameLength;
    frameCount += 1;
  }

  if (frameCount === 0 || sampleRate == null) {
    throw new Mp3ParseError("MP3_NO_FRAME_SYNC");
  }
  if (offset !== audioEnd) {
    throw new Mp3ParseError("MP3_TRAILING_GARBAGE");
  }

  const durationSeconds = totalSamples / sampleRate;
  if (durationSeconds > MAX_MP3_SECONDS) {
    throw new Mp3ParseError("MP3_DURATION");
  }

  return { sampleRate, totalSamples, durationSeconds, frameCount };
}

export function assertValidMp3Bytes(bytes: Uint8Array): ParsedMp3Audio {
  const parsed = parseMp3Audio(bytes);
  if (parsed.frameCount < 2) {
    throw new Mp3ParseError("MP3_INSUFFICIENT_FRAMES");
  }
  return parsed;
}

export function verifyMp3RefAgainstBytes(
  bytes: Uint8Array,
  rate: number,
  sampleCount: number,
): void {
  assertValidMp3Bytes(bytes);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Mp3ParseError("SOUND_RATE");
  }
  if (!Number.isFinite(sampleCount) || sampleCount <= 0) {
    throw new Mp3ParseError("SOUND_SAMPLE_COUNT");
  }
  if (sampleCount / rate > MAX_MP3_SECONDS) {
    throw new Mp3ParseError("SOUND_DURATION");
  }
}
