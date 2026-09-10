import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {describe, expect, it} from "vitest";
import {loadSb3} from "./index.js";
import {projectJsonToDocument} from "./canonical-io.js";
import {parseWavBytes} from "./verify-media-bytes.js";

const fixturesDir = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../test/fixtures",
);

describe("classroom SB3 import hardening", () => {
  it("ignores TurboWarp extensionURLs instead of rejecting the project", () => {
    expect(() =>
      projectJsonToDocument({
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
            costumes: [
              {
                assetId: "cd21514d0531fdffb22204e0ec5ed84a",
                name: "backdrop1",
                md5ext: "cd21514d0531fdffb22204e0ec5ed84a.svg",
                dataFormat: "svg",
                rotationCenterX: 240,
                rotationCenterY: 180,
              },
            ],
            sounds: [],
            volume: 100,
            layerOrder: 0,
            tempo: 60,
            videoTransparency: 50,
            videoState: "on",
            textToSpeechLanguage: null,
          },
        ],
        monitors: [],
        extensions: [],
        extensionURLs: {
          fakeExt: "https://example.invalid/fake.mjs",
        },
        meta: {semver: "3.0.0", vm: "0.0.0", agent: "test"},
      }),
    ).not.toThrow();
  });

  it("imports りんごキャッチゲーム.sb3 (extensionURLs + IMA ADPCM)", async () => {
    const result = await loadSb3(
      readFileSync(path.join(fixturesDir, "ringo-catch-game.sb3")),
    );
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.document?.targets.map(t => t.name)).toEqual(
      expect.arrayContaining(["Stage", "Bowl", "Apple", "Beachball"]),
    );
  }, 60000);

  it("parses Scratch IMA ADPCM wav from the apple project", async () => {
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(
      readFileSync(path.join(fixturesDir, "ringo-catch-game.sb3")),
    );
    const entry = zip.file("1727f65b5f22d151685b8e5917456a60.wav");
    expect(entry).toBeTruthy();
    const wav = new Uint8Array(await entry!.async("uint8array"));
    const parsed = parseWavBytes(wav);
    expect(parsed.sampleRate).toBe(22050);
    expect(parsed.sampleFrames).toBeGreaterThan(0);
  });
});
