import {describe, expect, it} from "vitest";
import type {ProjectDocument} from "@blocksync/project-schema";
import {captureLiveProjectSnapshot} from "./live-project-snapshot.js";

function emptyDoc(id = "stage"): ProjectDocument {
  return {
    schemaVersion: 1,
    targets: [
      {
        id,
        name: "Stage",
        isStage: true,
        blocks: {},
      },
    ],
  };
}

describe("captureLiveProjectSnapshot", () => {
  it("returns no-vm when the VM reader is missing", () => {
    const result = captureLiveProjectSnapshot({readVmJson: null});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("no-vm");
      expect(result.message).toContain("読み込まれてい");
    }
  });

  it("returns invalid-json for malformed VM JSON", () => {
    const result = captureLiveProjectSnapshot({
      readVmJson: () => "{not-json",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid-json");
  });

  it("returns a normal snapshot from VM JSON", () => {
    const previous = emptyDoc("prev-stage");
    const result = captureLiveProjectSnapshot({
      readVmJson: () =>
        JSON.stringify({
          targets: [
            {
              isStage: true,
              name: "Stage",
              variables: {},
              lists: {},
              broadcasts: {},
              blocks: {},
              comments: {},
              currentCostume: 0,
              costumes: [],
              sounds: [],
              volume: 100,
              layerOrder: 0,
              tempo: 60,
              videoTransparency: 50,
              videoState: "on",
              textToSpeechLanguage: null,
            },
          ],
          meta: {semver: "3.0.0"},
        }),
      previousDocument: previous,
      convert: () => emptyDoc("converted"),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.snapshot.document.targets[0]?.id).toBe("prev-stage");
      expect(result.snapshot.rawProjectJson).toBeTruthy();
    }
  });

  it("does not silently return previousDocument on conversion failure", () => {
    const previous = emptyDoc("stale");
    const result = captureLiveProjectSnapshot({
      readVmJson: () => JSON.stringify({targets: []}),
      previousDocument: previous,
      convert: () => {
        throw new Error("boom");
      },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("conversion-failed");
    }
  });

  it("reflects unsaved edits present in the VM JSON reader", () => {
    let steps = "10";
    const convert = (raw: unknown): ProjectDocument => {
      const json = raw as {
        targets: Array<{blocks: Record<string, {inputs?: {STEPS?: unknown[]}}>}>;
      };
      const stepInput = json.targets[0]?.blocks.move?.inputs?.STEPS;
      const value = Array.isArray(stepInput?.[1])
        ? String((stepInput[1] as unknown[])[1])
        : "0";
      return {
        schemaVersion: 1,
        targets: [
          {
            id: "s1",
            name: "Sprite1",
            isStage: false,
            blocks: {
              move: {
                id: "move",
                opcode: "motion_movesteps",
                next: null,
                parent: null,
                inputs: {STEPS: [1, [4, value]]},
                fields: {},
                topLevel: true,
              },
            },
          },
        ],
      };
    };

    const first = captureLiveProjectSnapshot({
      readVmJson: () =>
        JSON.stringify({
          targets: [
            {
              blocks: {
                move: {inputs: {STEPS: [1, [4, steps]]}},
              },
            },
          ],
        }),
      convert,
    });
    steps = "99";
    const second = captureLiveProjectSnapshot({
      readVmJson: () =>
        JSON.stringify({
          targets: [
            {
              blocks: {
                move: {inputs: {STEPS: [1, [4, steps]]}},
              },
            },
          ],
        }),
      convert,
    });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      const a = first.snapshot.document.targets[0]!.blocks.move as {
        inputs: {STEPS: unknown[]};
      };
      const b = second.snapshot.document.targets[0]!.blocks.move as {
        inputs: {STEPS: unknown[]};
      };
      expect((a.inputs.STEPS[1] as unknown[])[1]).toBe("10");
      expect((b.inputs.STEPS[1] as unknown[])[1]).toBe("99");
    }
  });
});
