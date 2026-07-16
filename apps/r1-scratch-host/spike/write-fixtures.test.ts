import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { spikeAssetBundle } from "./assets.js";
import { buildCatWithSoundSb3, buildCustomProcedureSb3 } from "./project-fixtures.js";
import { documentAfterFirstLoad } from "./sb3-round-trip.js";
import { browserAssetPayload } from "./browser/browser-asset-payload.js";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const browserFixturesDir = join(dirname(fileURLToPath(import.meta.url)), "browser/fixtures");

it("writes expected fixture JSON (run: pnpm write-fixtures)", async () => {
  const assets = spikeAssetBundle();
  mkdirSync(fixturesDir, { recursive: true });
  mkdirSync(browserFixturesDir, { recursive: true });

  const catDoc = await documentAfterFirstLoad(buildCatWithSoundSb3(), assets);
  const procDoc = await documentAfterFirstLoad(buildCustomProcedureSb3(), assets);

  writeFileSync(
    join(fixturesDir, "cat-with-sound.expected.json"),
    `${JSON.stringify(catDoc, null, 2)}\n`,
  );
  writeFileSync(
    join(fixturesDir, "custom-procedure.expected.json"),
    `${JSON.stringify(procDoc, null, 2)}\n`,
  );

  const { assets: b64, catProject } = browserAssetPayload();
  writeFileSync(
    join(browserFixturesDir, "assets.b64.json"),
    `${JSON.stringify(b64, null, 2)}\n`,
  );
  writeFileSync(
    join(browserFixturesDir, "cat-project.json"),
    `${JSON.stringify(catProject, null, 2)}\n`,
  );
});
