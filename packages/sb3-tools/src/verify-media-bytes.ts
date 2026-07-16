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
      if (audioFormat !== 1) {
        throw new MediaVerifyError("WAV_PCM_ONLY");
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
    throw new MediaVerifyError("WAV_MISSING_CHUNKS");
  }
  if (channels <= 0 || bitsPerSample <= 0 || sampleRate <= 0) {
    throw new MediaVerifyError("WAV_FMT_VALUES");
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
