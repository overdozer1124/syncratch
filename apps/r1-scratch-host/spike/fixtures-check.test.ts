import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { spikeAssetBundle } from "./assets.js";
import { buildCatWithSoundSb3, buildCustomProcedureSb3 } from "./project-fixtures.js";
import { documentAfterFirstLoad } from "./sb3-round-trip.js";
import { equivalenceSpikeV0 } from "./equivalence-spike-v0.js";
import type { DocumentSpikeV0 } from "./schema/document-spike-v0.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function loadGolden(name: string): DocumentSpikeV0 {
  return JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as DocumentSpikeV0;
}

describe("committed golden fixtures (read-only gate)", () => {
  it("cat-with-sound.expected.json matches VM first-load baseline", async () => {
    const assets = spikeAssetBundle();
    const actual = await documentAfterFirstLoad(buildCatWithSoundSb3(), assets);
    expect(equivalenceSpikeV0(actual, loadGolden("cat-with-sound.expected.json"))).toBe(
      true,
    );
  });

  it("custom-procedure.expected.json matches VM first-load baseline", async () => {
    const assets = spikeAssetBundle();
    const actual = await documentAfterFirstLoad(buildCustomProcedureSb3(), assets);
    expect(
      equivalenceSpikeV0(actual, loadGolden("custom-procedure.expected.json")),
    ).toBe(true);
  });

  it("detects intentional golden fixture corruption", async () => {
    const assets = spikeAssetBundle();
    const actual = await documentAfterFirstLoad(buildCatWithSoundSb3(), assets);
    const golden = loadGolden("cat-with-sound.expected.json");
    const corrupted: DocumentSpikeV0 = structuredClone(golden);
    const stage = corrupted.targets.find((t) => t.isStage);
    if (stage) stage.volume = stage.volume === 100 ? 99 : 100;
    expect(equivalenceSpikeV0(actual, corrupted)).toBe(false);
  });
});
