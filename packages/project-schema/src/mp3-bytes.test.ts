import { describe, expect, it } from "vitest";
import {
  assertValidMp3Bytes,
  Mp3ParseError,
  parseMp3Audio,
  verifyMp3RefAgainstBytes,
} from "./mp3-bytes.js";

/** Minimal MPEG1 Layer III frames (128kbps / 44.1kHz, 417 bytes each). */
export function minimalMp3FrameBytes(frameCount: number): Uint8Array {
  const header = [0xff, 0xfb, 0x90, 0x00] as const;
  const frameLength = 417;
  const buf = new Uint8Array(frameLength * frameCount);
  for (let frame = 0; frame < frameCount; frame++) {
    buf.set(header, frame * frameLength);
  }
  return buf;
}

/** ID3v2.4 tag with TIT2 frame and matching 3DI footer (official size semantics). */
export function buildId3v24TagWithFooter(audio: Uint8Array): Uint8Array {
  const tagBody = new Uint8Array([
    0x54, 0x49, 0x54, 0x32,
    0x00, 0x00, 0x00, 0x01,
    0x00, 0x00,
    0x00,
  ]);
  const tagSize = tagBody.length;
  const header = new Uint8Array([
    0x49, 0x44, 0x33,
    0x04, 0x00,
    0x10,
    0x00, 0x00, 0x00, tagSize,
  ]);
  const footer = new Uint8Array([
    0x33, 0x44, 0x49,
    0x04, 0x00,
    0x10,
    0x00, 0x00, 0x00, tagSize,
  ]);
  const bytes = new Uint8Array(10 + tagSize + 10 + audio.length);
  bytes.set(header, 0);
  bytes.set(tagBody, 10);
  bytes.set(footer, 10 + tagSize);
  bytes.set(audio, 10 + tagSize + 10);
  return bytes;
}

describe("mp3-bytes", () => {
  it("accepts consecutive valid MP3 frames", () => {
    const bytes = minimalMp3FrameBytes(2);
    const parsed = assertValidMp3Bytes(bytes);
    expect(parsed.frameCount).toBe(2);
    expect(parsed.sampleRate).toBe(44100);
  });

  it("rejects MP3 longer than 60 seconds", () => {
    const bytes = minimalMp3FrameBytes(2300);
    expect(() => parseMp3Audio(bytes)).toThrow(Mp3ParseError);
    try {
      parseMp3Audio(bytes);
    } catch (error) {
      expect(error).toBeInstanceOf(Mp3ParseError);
      expect((error as Mp3ParseError).code).toBe("MP3_DURATION");
    }
  });

  it("accepts MP3 at the 60 second ceiling", () => {
    const bytes = minimalMp3FrameBytes(2296);
    const parsed = parseMp3Audio(bytes);
    expect(parsed.durationSeconds).toBeLessThanOrEqual(60);
    expect(parsed.durationSeconds).toBeGreaterThan(59.9);
  });

  it("rejects actual duration over 60 seconds via frame scan", () => {
    const bytes = minimalMp3FrameBytes(2300);
    expect(() => verifyMp3RefAgainstBytes(bytes, 44100, 44100)).toThrow(
      Mp3ParseError,
    );
    try {
      verifyMp3RefAgainstBytes(bytes, 44100, 44100);
    } catch (error) {
      expect((error as Mp3ParseError).code).toBe("MP3_DURATION");
    }
  });

  it("accepts Scratch metadata when frame scan duration differs but actual <= 60s", () => {
    const bytes = minimalMp3FrameBytes(2);
    expect(() => verifyMp3RefAgainstBytes(bytes, 44100, 1)).not.toThrow();
  });

  it("accepts official ID3v2.4 tag with footer after tag body", () => {
    const bytes = buildId3v24TagWithFooter(minimalMp3FrameBytes(2));
    expect(() => assertValidMp3Bytes(bytes)).not.toThrow();
  });

  it("rejects incorrect ID3v2.4 footer placement inside tag size", () => {
    const audio = minimalMp3FrameBytes(2);
    const header = new Uint8Array([
      0x49, 0x44, 0x33, 0x04, 0x00, 0x10, 0x00, 0x00, 0x00, 0x0a,
    ]);
    const footer = new Uint8Array([
      0x33, 0x44, 0x49, 0x04, 0x00, 0x10, 0x00, 0x00, 0x00, 0x0a,
    ]);
    const bytes = new Uint8Array(header.length + footer.length + audio.length);
    bytes.set(header, 0);
    bytes.set(footer, header.length);
    bytes.set(audio, header.length + footer.length);
    expect(() => assertValidMp3Bytes(bytes)).toThrow(Mp3ParseError);
    try {
      assertValidMp3Bytes(bytes);
    } catch (error) {
      expect((error as Mp3ParseError).code).toBe("ID3_FOOTER");
    }
  });

  it("rejects ID3 footer flag on versions before 2.4", () => {
    const audio = minimalMp3FrameBytes(2);
    const header = new Uint8Array([
      0x49, 0x44, 0x33, 0x03, 0x00, 0x10, 0x00, 0x00, 0x00, 0x00,
    ]);
    const bytes = new Uint8Array(header.length + audio.length);
    bytes.set(header, 0);
    bytes.set(audio, header.length);
    expect(() => assertValidMp3Bytes(bytes)).toThrow(Mp3ParseError);
    try {
      assertValidMp3Bytes(bytes);
    } catch (error) {
      expect((error as Mp3ParseError).code).toBe("ID3_FOOTER_VERSION");
    }
  });

  it("rejects non-synchsafe ID3 tag size bytes", () => {
    const audio = minimalMp3FrameBytes(2);
    const header = new Uint8Array([
      0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x80, 0x00,
    ]);
    const bytes = new Uint8Array(header.length + audio.length);
    bytes.set(header, 0);
    bytes.set(audio, header.length);
    expect(() => assertValidMp3Bytes(bytes)).toThrow(Mp3ParseError);
    try {
      assertValidMp3Bytes(bytes);
    } catch (error) {
      expect((error as Mp3ParseError).code).toBe("ID3_SYNCHSAFE");
    }
  });

  it("rejects trailing garbage after final frame", () => {
    const bytes = minimalMp3FrameBytes(2);
    const withGarbage = new Uint8Array(bytes.length + 1);
    withGarbage.set(bytes);
    withGarbage[withGarbage.length - 1] = 0x01;
    expect(() => parseMp3Audio(withGarbage)).toThrow(Mp3ParseError);
    try {
      parseMp3Audio(withGarbage);
    } catch (error) {
      expect((error as Mp3ParseError).code).toBe("MP3_TRAILING_GARBAGE");
    }
  });
});
