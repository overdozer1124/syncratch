import {cp, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {remapScratchChromePurpleToBlue} from "./remap-scratch-chrome-colors.mjs";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(appRoot, "../..");
const publicDir = join(appRoot, "public");
const generated = join(publicDir, "generated");
const guiDist = join(
  repoRoot,
  "vendor/scratch-editor/packages/scratch-gui/dist",
);
const guiSource = join(guiDist, "scratch-gui-standalone.js");
const fixtureSource = join(
  repoRoot,
  "apps/r1-scratch-host/spike/browser/fixtures",
);

const generatedGuiAssets = [
  join(publicDir, "static"),
  join(publicDir, "chunks"),
  join(publicDir, "extension-worker.js"),
  join(publicDir, "extension-worker.js.map"),
  join(publicDir, "extension-worker.js.LICENSE.txt"),
];

await rm(generated, {recursive: true, force: true});
await Promise.all(
  generatedGuiAssets.map(path => rm(path, {recursive: true, force: true})),
);

await mkdir(join(generated, "gui"), {recursive: true});
await mkdir(join(generated, "fixtures"), {recursive: true});

// Scratch GUI standalone is built with webpack publicPath "/". Rewrite to a
// runtime base so GitHub Pages / subpath deploys can load icons and workers.
let guiBundle = await readFile(guiSource, "utf8");
guiBundle = guiBundle.replace(
  /(__webpack_require__\.p\s*=\s*)"\/"/g,
  "$1(typeof window!==\"undefined\"&&window.__BLOCKSYNC_GUI_PUBLIC_PATH__)||\"/\"",
);
guiBundle = guiBundle.replace(
  /(__nested_webpack_require_\d+\__\.p\s*=\s*)"\/"/g,
  "$1(typeof window!==\"undefined\"&&window.__BLOCKSYNC_GUI_PUBLIC_PATH__)||\"/\"",
);
// MediaPipe face detection hardcodes an absolute /chunks path.
guiBundle = guiBundle.replaceAll(
  '"/chunks/mediapipe/',
  '(window.__BLOCKSYNC_GUI_PUBLIC_PATH__||"/")+"chunks/mediapipe/',
);
// Scratch chrome accent is looks-secondary purple; Syncratch uses blue.
// Looks block colourSecondary (#855CD6) is preserved inside the remapper.
guiBundle = remapScratchChromePurpleToBlue(guiBundle);
await writeFile(join(generated, "gui/scratch-gui-standalone.js"), guiBundle);

await cp(fixtureSource, join(generated, "fixtures"), {recursive: true});
await cp(join(guiDist, "static"), join(publicDir, "static"), {recursive: true});
await cp(join(guiDist, "chunks"), join(publicDir, "chunks"), {recursive: true});
await cp(
  join(guiDist, "extension-worker.js"),
  join(publicDir, "extension-worker.js"),
);
for (const name of [
  "extension-worker.js.map",
  "extension-worker.js.LICENSE.txt",
]) {
  try {
    await cp(join(guiDist, name), join(publicDir, name));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      continue;
    }
    throw error;
  }
}
