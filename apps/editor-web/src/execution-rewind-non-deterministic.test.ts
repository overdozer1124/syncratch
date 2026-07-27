import {describe, expect, it} from "vitest";
import {
  extractExtensionIds,
  isDeterministicProcedureReporterOpcode,
  isUnsupportedNonDeterministicOpcode,
  resolveNonDeterministicOpcode,
  SAFE_EXTENSION_OPCODES,
} from "./execution-rewind-non-deterministic.js";
import type {RewindOrigin} from "./execution-rewind-types.js";
import type {ProjectDocument} from "@blocksync/project-schema";

function emptyDocument(extensions: string[] = []): ProjectDocument {
  return {
    schemaVersion: 1,
    targets: [],
    monitors: [],
    extensions,
    meta: {},
  };
}

function makeOrigin(extensions: string[]): RewindOrigin {
  return {
    document: emptyDocument(extensions),
    assets: new Map(),
    projectSessionId: 1,
    blockGraphHash: "0",
    vmProjectJson: {extensions, targets: [], monitors: []},
  };
}

describe("execution-rewind-non-deterministic", () => {
  it("extracts extension ids from document and vmProjectJson", () => {
    expect(extractExtensionIds(makeOrigin(["music", "pen"]))).toEqual([
      "music",
      "pen",
    ]);
  });

  it("detects sensing reporters as unsupported", () => {
    expect(resolveNonDeterministicOpcode("sensing_current", [])).toBe(
      "extensionReporter",
    );
    expect(resolveNonDeterministicOpcode("sensing_dayssince2000", [])).toBe(
      "extensionReporter",
    );
    expect(resolveNonDeterministicOpcode("sensing_online", [])).toBe(
      "extensionReporter",
    );
    expect(resolveNonDeterministicOpcode("sensing_username", [])).toBe(
      "extensionReporter",
    );
    expect(isUnsupportedNonDeterministicOpcode("sensing_username", [])).toBe(
      true,
    );
  });

  it("flags loaded extension opcodes unless explicitly safe", () => {
    expect(
      resolveNonDeterministicOpcode("music_playDrumForBeats", ["music"]),
    ).toBe("extensionReporter");
    expect(resolveNonDeterministicOpcode("pen_clear", ["pen"])).toBe(
      "extensionReporter",
    );
    expect(
      resolveNonDeterministicOpcode("text2speech_speak", ["text2speech"]),
    ).toBe("extensionReporter");
  });

  it("ignores extension opcodes when the extension is not loaded", () => {
    expect(resolveNonDeterministicOpcode("music_playDrumForBeats", [])).toBeNull();
  });

  it("allows explicitly safe extension opcodes", () => {
    SAFE_EXTENSION_OPCODES.add("music_getTempo");
    try {
      expect(
        resolveNonDeterministicOpcode("music_getTempo", ["music"]),
      ).toBeNull();
    } finally {
      SAFE_EXTENSION_OPCODES.delete("music_getTempo");
    }
  });

  it("ignores argument_reporter_* opcodes", () => {
    expect(isDeterministicProcedureReporterOpcode("argument_reporter_string_number")).toBe(
      true,
    );
    expect(
      resolveNonDeterministicOpcode("argument_reporter_string_number", [
        "music",
      ]),
    ).toBeNull();
    expect(
      isUnsupportedNonDeterministicOpcode("argument_reporter_boolean", [
        "pen",
      ]),
    ).toBe(false);
  });
});
