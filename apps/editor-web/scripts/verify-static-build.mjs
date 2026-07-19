import {access, readFile, readdir} from "node:fs/promises";
import {join} from "node:path";
import {fileURLToPath} from "node:url";

const appRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const dist = join(appRoot, "dist");
const configuredBase = process.env.BLOCKSYNC_BASE_PATH?.trim() || "/";
const base = configuredBase.endsWith("/") ? configuredBase : `${configuredBase}/`;

const indexHtml = await readFile(join(dist, "index.html"), "utf8");
if (!indexHtml.includes(`${base}generated/gui/scratch-gui-standalone.js`)) {
  throw new Error(`Static GUI asset is not rooted at ${base}`);
}
if (indexHtml.includes("collab-harness")) {
  throw new Error("Production build must not publish the E2E collaboration harness");
}

await Promise.all([
  access(join(dist, "generated/fixtures/cat-project.json")),
  access(join(dist, "generated/fixtures/assets.b64.json")),
  access(join(dist, "generated/gui/scratch-gui-standalone.js")),
]);

const assetFiles = await readdir(join(dist, "assets"));
const mainScript = assetFiles.find(file => /^main-.*\.js$/.test(file));
if (!mainScript) throw new Error("Production JavaScript bundle is missing");
const bundle = await readFile(join(dist, "assets", mainScript), "utf8");
if (
  !bundle.includes(base) ||
  !bundle.includes("generated/fixtures/cat-project.json")
) {
  throw new Error("Runtime fixture URLs do not use the configured static base");
}

console.log(`Static artifact verified for base ${base}`);
