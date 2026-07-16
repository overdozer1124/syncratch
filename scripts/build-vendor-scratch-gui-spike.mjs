#!/usr/bin/env node
/**
 * Build scratch-gui standalone bundle for Task 0 embed spike.
 * Does not modify tracked vendor sources — only produces dist/ outputs.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = join(root, "vendor/scratch-editor");
const guiPkg = join(vendor, "packages/scratch-gui");
const standaloneOut = join(guiPkg, "dist/scratch-gui-standalone.js");

function run(cwd, cmd, args, env = process.env) {
  console.log(`[build-gui-spike] ${cwd}\n  ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: true,
    env,
  });
  if (r.status !== 0) {
    process.exit(r.status ?? 1);
  }
}

if (!existsSync(join(vendor, "package.json"))) {
  console.error("vendor/scratch-editor missing");
  process.exit(1);
}

if (!existsSync(join(vendor, "node_modules"))) {
  run(vendor, "npm", ["ci", "--ignore-scripts"]);
}

run(guiPkg, "npm", ["run", "prepare"]);

const vmDist = join(vendor, "packages/scratch-vm/dist/node/scratch-vm.js");
if (!existsSync(vmDist)) {
  run(root, "node", ["scripts/build-vendor-scratch-vm.mjs"]);
}

run(guiPkg, "npx", [
  "--no-install",
  "cross-env",
  "NODE_ENV=production",
  "BUILD_TYPE=dist-standalone",
  "webpack",
  "--progress",
]);

if (!existsSync(standaloneOut)) {
  console.error("Build finished but standalone dist missing:", standaloneOut);
  process.exit(1);
}
console.log("[build-gui-spike] OK", standaloneOut);
