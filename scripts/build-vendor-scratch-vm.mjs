#!/usr/bin/env node
/**
 * Build Scratch packages needed for Gate 0 VM from the pinned vendor checkout.
 * Does not modify tracked vendor sources — only produces dist/ outputs.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendor = join(root, "vendor/scratch-editor");

function run(cwd, cmd, args) {
  console.log(`[build-vendor] ${cwd}\n  ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: true,
    env: process.env,
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

// Published/lock may resolve entities without `./decode`; webpack Node bundle needs it.
run(vendor, "npm", ["install", "entities@6.0.1", "--no-save", "--ignore-scripts"]);

const pkgs = [
  "packages/scratch-svg-renderer",
  "packages/scratch-render",
  "packages/scratch-vm",
];

for (const pkg of pkgs) {
  run(join(vendor, pkg), "npx", ["--no-install", "webpack", "--progress"]);
}

const vmDist = join(vendor, "packages/scratch-vm/dist/node/scratch-vm.js");
if (!existsSync(vmDist)) {
  console.error("Build finished but VM dist missing:", vmDist);
  process.exit(1);
}
console.log("[build-vendor] OK", vmDist);
