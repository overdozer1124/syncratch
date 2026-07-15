#!/usr/bin/env node
/**
 * Verifies:
 * 1) Parent repo indexes vendor/scratch-editor as gitlink (mode 160000) at pin SHA
 * 2) Submodule working tree HEAD equals pin SHA and has no tracked mods
 * 3) Vendor VM dist exists
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pinPath = join(root, "docs", "gate0", "SCRATCH_PIN.md");
const vendor = join(root, "vendor", "scratch-editor");

function fail(msg) {
  console.error(`[gate0:check-pin] FAIL: ${msg}`);
  process.exit(1);
}

function git(args, cwd = root) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

if (!existsSync(pinPath)) fail("docs/gate0/SCRATCH_PIN.md missing");
if (!existsSync(vendor)) fail("vendor/scratch-editor missing");

const pinDoc = readFileSync(pinPath, "utf8");
const m = pinDoc.match(/^\*\*Upstream commit SHA:\*\*\s*`([0-9a-f]{40})`/m);
if (!m) fail("Could not parse Upstream commit SHA from SCRATCH_PIN.md");
const expected = m[1];

// Parent must record a gitlink (mode 160000), not a plain tree.
let stage;
try {
  stage = git(["ls-files", "--stage", "vendor/scratch-editor"]);
} catch {
  fail("git ls-files --stage vendor/scratch-editor failed");
}
if (!stage) {
  fail(
    "vendor/scratch-editor is not in the parent index (gitlink missing). Restore submodule.",
  );
}
const stageLine = stage.split("\n")[0];
const stageParts = stageLine.split(/\s+/);
if (stageParts[0] !== "160000") {
  fail(
    `vendor/scratch-editor must be mode 160000 gitlink, got:\n${stageLine}`,
  );
}
const indexSha = stageParts[1];
if (indexSha !== expected) {
  fail(
    `Parent gitlink SHA mismatch: expected ${expected}, index has ${indexSha}`,
  );
}
console.log(`[gate0:check-pin] OK: parent gitlink 160000 ${indexSha}`);

// Submodule must use gitfile → modules/, not an independent nested repo.
const gitPath = join(vendor, ".git");
if (!existsSync(gitPath)) {
  fail("vendor/scratch-editor/.git missing — run: git submodule update --init");
}
const gitMeta = readFileSync(gitPath, "utf8");
if (!gitMeta.startsWith("gitdir:")) {
  fail(
    "vendor/scratch-editor/.git must be a gitfile (gitdir: .../modules/...), not a nested repository",
  );
}
if (!gitMeta.includes("modules/vendor/scratch-editor")) {
  fail(`Unexpected submodule gitdir:\n${gitMeta}`);
}

let actual;
try {
  actual = git(["rev-parse", "HEAD"], vendor);
} catch {
  fail("git rev-parse failed in vendor/scratch-editor");
}
if (actual !== expected) {
  fail(`Submodule HEAD mismatch: expected ${expected}, got ${actual}`);
}

const status = git(
  ["status", "--porcelain", "--untracked-files=no"],
  vendor,
);
if (status.length > 0) {
  fail(`vendor/scratch-editor has tracked modifications:\n${status}`);
}

const vmDist = join(
  vendor,
  "packages/scratch-vm/dist/node/scratch-vm.js",
);
if (!existsSync(vmDist)) {
  fail(
    `vendor VM build missing: ${vmDist}\nRun: node scripts/build-vendor-scratch-vm.mjs`,
  );
}

console.log(`[gate0:check-pin] OK: submodule HEAD ${actual}`);
console.log(`[gate0:check-pin] OK: vendor VM dist present`);
