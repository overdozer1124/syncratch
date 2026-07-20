import {describe, expect, it} from "vitest";
import {
  DATA_CHANNEL_CHUNK_CHARS,
  DATA_CHANNEL_MAX_CHUNKS,
  createChunkReassembler,
  packDataChannelWire,
} from "./data-channel-framing.js";

describe("packDataChannelWire / createChunkReassembler", () => {
  it("sends small wires as bare strings (no JSON wrap)", () => {
    const frames = packDataChannelWire("hello-base64-like");
    expect(frames).toEqual(["hello-base64-like"]);
  });

  it("splits large wires and reassembles in order", () => {
    const wire = "x".repeat(DATA_CHANNEL_CHUNK_CHARS * 2 + 50);
    const frames = packDataChannelWire(wire, DATA_CHANNEL_CHUNK_CHARS, () => "msg-1");
    expect(frames.length).toBe(3);
    expect(frames.every(frame => frame.startsWith("{"))).toBe(true);

    const reassembler = createChunkReassembler();
    expect(reassembler.push(frames[0]!)).toBeNull();
    expect(reassembler.push(frames[1]!)).toBeNull();
    expect(reassembler.push(frames[2]!)).toBe(wire);
  });

  it("accepts bare wire strings without JSON parsing", () => {
    const reassembler = createChunkReassembler();
    expect(reassembler.push("not-json-wire")).toBe("not-json-wire");
  });

  it("still accepts legacy full frames from older builds", () => {
    const reassembler = createChunkReassembler();
    const frame = JSON.stringify({v: 1, t: "full", d: "legacy-wire"});
    expect(reassembler.push(frame)).toBe("legacy-wire");
  });

  it("rejects chunk frames with an unbounded part count", () => {
    const reassembler = createChunkReassembler();
    const frame = JSON.stringify({
      v: 1,
      t: "chunk",
      id: "big",
      i: 0,
      n: DATA_CHANNEL_MAX_CHUNKS + 1,
      d: "x",
    });
    expect(reassembler.push(frame)).toBeNull();
  });
});
