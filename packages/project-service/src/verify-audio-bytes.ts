import { AssetRefMismatchError } from "./errors.js";

const MAX_PCM_SAMPLES = 5_292_000;
const MAX_AUDIO_SECONDS = 60;

export interface ParsedWav {
  sampleRate: number;
  sampleFrames: number;
}

function readFourCc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!,
  );
}

function readU32LE(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset]! |
      (bytes[offset + 1]! << 8) |
      (bytes[offset + 2]! << 16) |
      (bytes[offset + 3]! << 24)) >>>
    0
  );
}

function readU16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

/** Parse RIFF/WAVE fmt+data (Design §6.3). */
export function parseWavBytes(bytes: Uint8Array): ParsedWav {
  if (bytes.length < 44) {
    throw new AssetRefMismatchError("WAV_TOO_SHORT");
  }
  if (readFourCc(bytes, 0) !== "RIFF" || readFourCc(bytes, 8) !== "WAVE") {
    throw new AssetRefMismatchError("WAV_RIFF");
  }

  let offset = 12;
  let sampleRate: number | null = null;
  let channels: number | null = null;
  let bitsPerSample: number | null = null;
  let dataBytes: number | null = null;

  while (offset + 8 <= bytes.length) {
    const chunkId = readFourCc(bytes, offset);
    const chunkSize = readU32LE(bytes, offset + 4);
    const chunkData = offset + 8;
    if (chunkData + chunkSize > bytes.length) {
      throw new AssetRefMismatchError("WAV_CHUNK_TRUNCATED");
    }
    if (chunkId === "fmt ") {
      if (chunkSize < 16) {
        throw new AssetRefMismatchError("WAV_FMT");
      }
      const audioFormat = readU16LE(bytes, chunkData);
      if (audioFormat !== 1) {
        throw new AssetRefMismatchError("WAV_PCM_ONLY");
      }
      channels = readU16LE(bytes, chunkData + 2);
      sampleRate = readU32LE(bytes, chunkData + 4);
      bitsPerSample = readU16LE(bytes, chunkData + 14);
    } else if (chunkId === "data") {
      dataBytes = chunkSize;
    }
    offset = chunkData + chunkSize + (chunkSize % 2);
  }

  if (
    sampleRate == null ||
    channels == null ||
    bitsPerSample == null ||
    dataBytes == null
  ) {
    throw new AssetRefMismatchError("WAV_MISSING_CHUNKS");
  }
  if (channels <= 0 || bitsPerSample <= 0 || sampleRate <= 0) {
    throw new AssetRefMismatchError("WAV_FMT_VALUES");
  }

  const blockAlign = (channels * bitsPerSample) / 8;
  if (blockAlign <= 0 || dataBytes % blockAlign !== 0) {
    throw new AssetRefMismatchError("WAV_DATA_ALIGN");
  }
  const sampleFrames = dataBytes / blockAlign;
  if (sampleFrames > MAX_PCM_SAMPLES) {
    throw new AssetRefMismatchError("WAV_SAMPLE_CEILING");
  }
  if (sampleFrames / sampleRate > MAX_AUDIO_SECONDS) {
    throw new AssetRefMismatchError("WAV_DURATION");
  }

  return { sampleRate, sampleFrames };
}

const MPEG1_L3_BITRATE_KBPS = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
];
const MPEG2_L3_BITRATE_KBPS = [
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
];
const MPEG1_SAMPLE_RATE = [44100, 48000, 32000];
const MPEG2_SAMPLE_RATE = [22050, 24000, 16000];
const MPEG25_SAMPLE_RATE = [11025, 12000, 8000];

const MIN_MP3_FRAMES = 2;

function isMp3FrameSync(byte1: number, byte2: number): boolean {
  return byte1 === 0xff && (byte2 & 0xe0) === 0xe0;
}

function lookupBitrateKbps(
  version: number,
  bitrateIndex: number,
): number {
  return version === 0x03
    ? MPEG1_L3_BITRATE_KBPS[bitrateIndex]!
    : MPEG2_L3_BITRATE_KBPS[bitrateIndex]!;
}

function lookupSampleRate(
  version: number,
  sampleRateIndex: number,
): number {
  if (version === 0x03) {
    return MPEG1_SAMPLE_RATE[sampleRateIndex]!;
  }
  if (version === 0x02) {
    return MPEG2_SAMPLE_RATE[sampleRateIndex]!;
  }
  return MPEG25_SAMPLE_RATE[sampleRateIndex]!;
}

function parseMp3FrameLength(bytes: Uint8Array, offset: number): number {
  if (offset + 4 > bytes.length) {
    throw new AssetRefMismatchError("MP3_FRAME_TRUNCATED");
  }
  const byte1 = bytes[offset + 1]!;
  const byte2 = bytes[offset + 2]!;
  const byte3 = bytes[offset + 3]!;

  if (!isMp3FrameSync(bytes[offset]!, byte1)) {
    throw new AssetRefMismatchError("MP3_FRAME_SYNC");
  }

  const version = (byte1 >> 3) & 0x03;
  const layer = (byte1 >> 1) & 0x03;
  if (version === 0x01) {
    throw new AssetRefMismatchError("MP3_VERSION_RESERVED");
  }
  if (layer === 0x00) {
    throw new AssetRefMismatchError("MP3_LAYER_RESERVED");
  }
  if (layer !== 0x01) {
    throw new AssetRefMismatchError("MP3_LAYER_NOT_III");
  }

  const bitrateIndex = (byte2 >> 4) & 0x0f;
  const sampleRateIndex = (byte2 >> 2) & 0x03;
  const padding = (byte2 >> 1) & 0x01;
  if (bitrateIndex === 0 || bitrateIndex === 0x0f) {
    throw new AssetRefMismatchError("MP3_BITRATE");
  }
  if (sampleRateIndex === 0x03) {
    throw new AssetRefMismatchError("MP3_SAMPLE_RATE");
  }
  if ((byte3 & 0x03) === 0x02) {
    throw new AssetRefMismatchError("MP3_EMPHASIS");
  }

  const bitrateKbps = lookupBitrateKbps(version, bitrateIndex);
  const sampleRate = lookupSampleRate(version, sampleRateIndex);
  if (bitrateKbps <= 0 || sampleRate <= 0) {
    throw new AssetRefMismatchError("MP3_HEADER_VALUES");
  }

  const frameLength =
    version === 0x03
      ? Math.floor((144 * bitrateKbps * 1000) / sampleRate) + padding
      : Math.floor((72 * bitrateKbps * 1000) / sampleRate) + padding;

  if (frameLength < 4) {
    throw new AssetRefMismatchError("MP3_FRAME_LENGTH");
  }
  if (offset + frameLength > bytes.length) {
    throw new AssetRefMismatchError("MP3_FRAME_BOUNDARY");
  }

  return frameLength;
}

function skipId3v2Tag(bytes: Uint8Array): number {
  if (bytes.length < 10) {
    return 0;
  }
  if (bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) {
    return 0;
  }
  const tagSize =
    ((bytes[6]! & 0x7f) << 21) |
    ((bytes[7]! & 0x7f) << 14) |
    ((bytes[8]! & 0x7f) << 7) |
    (bytes[9]! & 0x7f);
  return 10 + tagSize;
}

/** Validate MPEG frame headers and consecutive complete frames (Design §6.3). */
export function assertValidMp3Bytes(bytes: Uint8Array): void {
  if (bytes.length < 8) {
    throw new AssetRefMismatchError("MP3_TOO_SHORT");
  }

  let offset = skipId3v2Tag(bytes);
  if (offset >= bytes.length) {
    throw new AssetRefMismatchError("MP3_NO_FRAME_SYNC");
  }

  for (let frame = 0; frame < MIN_MP3_FRAMES; frame++) {
    if (offset + 4 > bytes.length) {
      throw new AssetRefMismatchError("MP3_INSUFFICIENT_FRAMES");
    }
    const frameLength = parseMp3FrameLength(bytes, offset);
    offset += frameLength;
  }
}

export function verifyWavRefAgainstBytes(
  bytes: Uint8Array,
  rate: number,
  sampleCount: number,
): void {
  const parsed = parseWavBytes(bytes);
  if (parsed.sampleRate !== rate) {
    throw new AssetRefMismatchError("WAV_RATE_MISMATCH");
  }
  if (parsed.sampleFrames !== sampleCount) {
    throw new AssetRefMismatchError("WAV_SAMPLE_COUNT_MISMATCH");
  }
  if (sampleCount / rate > MAX_AUDIO_SECONDS) {
    throw new AssetRefMismatchError("WAV_DURATION");
  }
}

export function verifyMp3RefAgainstBytes(
  bytes: Uint8Array,
  rate: number,
  sampleCount: number,
): void {
  assertValidMp3Bytes(bytes);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new AssetRefMismatchError("SOUND_RATE");
  }
  if (!Number.isFinite(sampleCount) || sampleCount <= 0) {
    throw new AssetRefMismatchError("SOUND_SAMPLE_COUNT");
  }
  if (sampleCount / rate > MAX_AUDIO_SECONDS) {
    throw new AssetRefMismatchError("SOUND_DURATION");
  }
}
