import {cp, mkdir, rm} from "node:fs/promises";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(appRoot, "../..");
const generated = join(appRoot, "public/generated");
const guiSource = join(
  repoRoot,
  "vendor/scratch-editor/packages/scratch-gui/dist/scratch-gui-standalone.js",
);
const fixtureSource = join(
  repoRoot,
  "apps/r1-scratch-host/spike/browser/fixtures",
);

await rm(generated, {recursive: true, force: true});
await mkdir(join(generated, "gui"), {recursive: true});
await mkdir(join(generated, "fixtures"), {recursive: true});
await cp(guiSource, join(generated, "gui/scratch-gui-standalone.js"));
await cp(fixtureSource, join(generated, "fixtures"), {recursive: true});
