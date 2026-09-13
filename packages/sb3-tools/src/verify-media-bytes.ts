/** Media byte verification for SB3 import (Design §6.3). */

import {
  assertValidMp3Bytes as assertValidMp3Shared,
  Mp3ParseError,
  verifyMp3RefAgainstBytes as verifyMp3Shared,
} from "@blocksync/project-schema";

export class MediaVerifyError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "MediaVerifyError";
  }
}

// Background music in a real project routinely runs past a minute, so the old
// 60s ceiling rejected sounds Scratch accepts. These bound decode memory
// (frames x 4 bytes, so ~58MB at the cap), not how long a song may be.
const MAX_AUDIO_SECONDS = 300;
const MAX_PCM_SAMPLES = MAX_AUDIO_SECONDS * 48_000;
const WAVE_FORMAT_PCM = 1;
/** Scratch 2 recorded sounds this way, and scratch-audio still decodes them. */
const WAVE_FORMAT_IMA_ADPCM = 17;

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

function mapMp3Error<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof Mp3ParseError) {
      throw new MediaVerifyError(error.code);
    }
    throw error;
  }
}

export function parseWavBytes(bytes: Uint8Array): ParsedWav {
  if (bytes.length < 44) {
    throw new MediaVerifyError("WAV_TOO_SHORT");
  }
  if (readFourCc(bytes, 0) !== "RIFF" || readFourCc(bytes, 8) !== "WAVE") {
    throw new MediaVerifyError("WAV_RIFF");
  }

  let offset = 12;
  let sampleRate: number | null = null;
  let channels: number | null = null;
  let bitsPerSample: number | null = null;
  let dataBytes: number | null = null;
  let isAdpcm = false;
  let adpcmBlockAlign = 0;

  while (offset + 8 <= bytes.length) {
    const chunkId = readFourCc(bytes, offset);
    const chunkSize = readU32LE(bytes, offset + 4);
    const chunkData = offset + 8;
    if (chunkData + chunkSize > bytes.length) {
      throw new MediaVerifyError("WAV_CHUNK_TRUNCATED");
    }
    if (chunkId === "fmt ") {
      if (chunkSize < 16) {
        throw new MediaVerifyError("WAV_FMT");
      }
      const audioFormat = readU16LE(bytes, chunkData);
      if (audioFormat !== WAVE_FORMAT_PCM && audioFormat !== WAVE_FORMAT_IMA_ADPCM) {
        throw new MediaVerifyError("WAV_PCM_ONLY");
      }
      isAdpcm = audioFormat === WAVE_FORMAT_IMA_ADPCM;
      channels = readU16LE(bytes, chunkData + 2);
      sampleRate = readU32LE(bytes, chunkData + 4);
      bitsPerSample = readU16LE(bytes, chunkData + 14);
      // IMA ADPCM packs samples into blocks, so blockAlign comes from the
      // header rather than from channels x bits.
      adpcmBlockAlign = readU16LE(bytes, chunkData + 12);
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
    throw new MediaVerifyError("WAV_MISSING_CHUNKS");
  }
  if (channels <= 0 || bitsPerSample <= 0 || sampleRate <= 0) {
    throw new MediaVerifyError("WAV_FMT_VALUES");
  }

  // ADPCM's data is a sequence of fixed-size blocks that each decode to many
  // frames, so frame count comes from the block layout, not from byte width.
  // The numbers only bound duration here; decoding is the audio engine's job.
  if (isAdpcm) {
    if (adpcmBlockAlign <= 0 || dataBytes % adpcmBlockAlign !== 0) {
      throw new MediaVerifyError("WAV_DATA_ALIGN");
    }
    const samplesPerBlock =
      ((adpcmBlockAlign - 4 * channels) * 8) / (bitsPerSample * channels) + 1;
    const frames = (dataBytes / adpcmBlockAlign) * samplesPerBlock;
    if (frames > MAX_PCM_SAMPLES) {
      throw new MediaVerifyError("WAV_SAMPLE_CEILING");
    }
    if (frames / sampleRate > MAX_AUDIO_SECONDS) {
      throw new MediaVerifyError("WAV_DURATION");
    }
    return { sampleRate, sampleFrames: frames };
  }

  const blockAlign = (channels * bitsPerSample) / 8;
  if (blockAlign <= 0 || dataBytes % blockAlign !== 0) {
    throw new MediaVerifyError("WAV_DATA_ALIGN");
  }
  const sampleFrames = dataBytes / blockAlign;
  if (sampleFrames > MAX_PCM_SAMPLES) {
    throw new MediaVerifyError("WAV_SAMPLE_CEILING");
  }
  if (sampleFrames / sampleRate > MAX_AUDIO_SECONDS) {
    throw new MediaVerifyError("WAV_DURATION");
  }

  return { sampleRate, sampleFrames };
}

export function assertValidMp3Bytes(bytes: Uint8Array): void {
  mapMp3Error(() => assertValidMp3Shared(bytes));
}

export function verifyWavRefAgainstBytes(
  bytes: Uint8Array,
  rate: number,
  sampleCount: number,
): void {
  parseWavBytes(bytes);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new MediaVerifyError("SOUND_RATE");
  }
  if (!Number.isFinite(sampleCount) || sampleCount <= 0) {
    throw new MediaVerifyError("SOUND_SAMPLE_COUNT");
  }
  if (sampleCount / rate > MAX_AUDIO_SECONDS) {
    throw new MediaVerifyError("WAV_DURATION");
  }
}

export function verifyMp3RefAgainstBytes(
  bytes: Uint8Array,
  rate: number,
  sampleCount: number,
): void {
  mapMp3Error(() => verifyMp3Shared(bytes, rate, sampleCount));
}
