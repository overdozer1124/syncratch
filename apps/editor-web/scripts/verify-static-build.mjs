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
if (!indexHtml.includes('rel="preload"') || !indexHtml.includes("as=\"script\"")) {
  throw new Error("Production index must preload the Scratch GUI script");
}
if (/<script[^>]+scratch-gui-standalone\.js/i.test(indexHtml)) {
  throw new Error("Scratch GUI must load asynchronously, not via a blocking script tag");
}
if (indexHtml.includes("collab-harness")) {
  throw new Error("Production build must not publish the E2E collaboration harness");
}

await Promise.all([
  access(join(dist, "generated/fixtures/cat-project.json")),
  access(join(dist, "generated/fixtures/assets.b64.json")),
  access(join(dist, "generated/gui/scratch-gui-standalone.js")),
  access(join(dist, "static/blocks-media/default/zoom-in.svg")),
  access(join(dist, "chunks")),
  access(join(dist, "extension-worker.js")),
]);

const guiBundle = await readFile(
  join(dist, "generated/gui/scratch-gui-standalone.js"),
  "utf8",
);
if (!guiBundle.includes("__BLOCKSYNC_GUI_PUBLIC_PATH__")) {
  throw new Error("GUI bundle was not rewritten for subpath asset loading");
}
if (!guiBundle.includes("#1565a9")) {
  throw new Error("GUI bundle was not remapped to Syncratch chrome blue");
}
if (guiBundle.includes("hsla(260, 60%, 60%, 1)")) {
  throw new Error("GUI bundle still contains Scratch purple chrome hsla tokens");
}
if (!guiBundle.includes('colourSecondary:"#855CD6"')) {
  throw new Error("Looks block colourSecondary must remain purple");
}

// Chrome icons are base64 data URIs — plain hex search misses them unless decoded.
{
  const purpleInSvg = /#(?:855[Cc][Dd]6|714[Ee][Bb]6|6736[Bb]5|6035[Bb]4)\b/;
  for (const match of guiBundle.matchAll(
    /data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/g,
  )) {
    const svg = Buffer.from(match[1], "base64").toString("utf8");
    if (purpleInSvg.test(svg)) {
      throw new Error(
        "GUI bundle still contains Scratch purple chrome fills in base64 SVG icons",
      );
    }
  }
}

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
