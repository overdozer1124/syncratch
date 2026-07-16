import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AssetRefMismatchError } from "./errors.js";
import {
  assertValidMp3Bytes,
  parseWavBytes,
  verifyMp3RefAgainstBytes,
  verifyWavRefAgainstBytes,
} from "./verify-audio-bytes.js";
import { minimalMpeg1Layer2FrameBytes, minimalMp3FrameBytes, minimalWavBytes } from "./test-wav-fixtures.js";

describe("verify-audio-bytes", () => {
  it("parses a valid WAV and matches rate/sampleCount", () => {
    const bytes = minimalWavBytes({ sampleCount: 1032, rate: 44100 });
    const parsed = parseWavBytes(bytes);
    expect(parsed.sampleRate).toBe(44100);
    expect(parsed.sampleFrames).toBe(1032);
    expect(() =>
      verifyWavRefAgainstBytes(bytes, 44100, 1032),
    ).not.toThrow();
  });

  it("rejects non-WAV bytes", () => {
    const bytes = new TextEncoder().encode("definitely not a WAV file");
    expect(() => parseWavBytes(bytes)).toThrow(AssetRefMismatchError);
  });

  it("rejects truncated WAV", () => {
    const bytes = minimalWavBytes({ sampleCount: 1032 }).slice(0, 20);
    expect(() => parseWavBytes(bytes)).toThrow(AssetRefMismatchError);
  });

  it("accepts Scratch SB3 metadata when raw WAV header differs", () => {
    const bytes = minimalWavBytes({ sampleCount: 258, rate: 11025 });
    expect(() => verifyWavRefAgainstBytes(bytes, 44100, 1032)).not.toThrow();
  });

  it("rejects invalid metadata duration even when WAV structure is valid", () => {
    const bytes = minimalWavBytes({ sampleCount: 100, rate: 44100 });
    expect(() => verifyWavRefAgainstBytes(bytes, 44100, 0)).toThrow(
      AssetRefMismatchError,
    );
  });

  it("rejects WAV longer than 60 seconds", () => {
    const bytes = minimalWavBytes({ sampleCount: 61, rate: 1 });
    expect(() => parseWavBytes(bytes)).toThrow(AssetRefMismatchError);
  });

  it("accepts consecutive valid MP3 frames", () => {
    const bytes = minimalMp3FrameBytes(2);
    expect(() => assertValidMp3Bytes(bytes)).not.toThrow();
  });

  it("rejects MPEG Layer II frames as MP3", () => {
    const bytes = minimalMpeg1Layer2FrameBytes(2);
    expect(() => assertValidMp3Bytes(bytes)).toThrow(AssetRefMismatchError);
  });

  it("rejects fake MP3 sync bytes", () => {
    const bytes = new Uint8Array([0xff, 0xe0, 0x00, 0x00]);
    expect(() => assertValidMp3Bytes(bytes)).toThrow(AssetRefMismatchError);
  });

  it("rejects invalid MP3 bytes", () => {
    const bytes = new TextEncoder().encode("definitely not mp3");
    expect(() => assertValidMp3Bytes(bytes)).toThrow(AssetRefMismatchError);
  });

  it("rejects MP3 with a truncated second frame", () => {
    const bytes = minimalMp3FrameBytes(2).slice(0, 420);
    expect(() => assertValidMp3Bytes(bytes)).toThrow(AssetRefMismatchError);
  });

  it("rejects MP3 longer than 60 seconds via frame scan", () => {
    const bytes = minimalMp3FrameBytes(2300);
    expect(() => assertValidMp3Bytes(bytes)).toThrow(AssetRefMismatchError);
  });

  it("accepts Scratch metadata when frame scan duration differs but actual <= 60s", () => {
    const bytes = minimalMp3FrameBytes(2);
    expect(() => verifyMp3RefAgainstBytes(bytes, 44100, 1)).not.toThrow();
  });

  it("rejects claimed metadata duration over 60 seconds", () => {
    const bytes = minimalMp3FrameBytes(2);
    expect(() => verifyMp3RefAgainstBytes(bytes, 1, 61)).toThrow(
      AssetRefMismatchError,
    );
  });
});

describe("verify-audio-bytes digest helper", () => {
  it("hashes minimal wav", () => {
    const bytes = minimalWavBytes({ sampleCount: 4 });
    expect(createHash("sha256").update(bytes).digest("hex")).toHaveLength(64);
  });
});
