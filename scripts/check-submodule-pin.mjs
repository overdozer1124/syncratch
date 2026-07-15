#!/usr/bin/env node
/**
 * Verifies vendor/scratch-editor is pinned to the SHA recorded in SCRATCH_PIN.md
 * and that the submodule working tree is clean.
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

if (!existsSync(pinPath)) fail("docs/gate0/SCRATCH_PIN.md missing");
if (!existsSync(vendor)) fail("vendor/scratch-editor missing — run git submodule update --init");

const pinDoc = readFileSync(pinPath, "utf8");
const m = pinDoc.match(/^\*\*Upstream commit SHA:\*\*\s*`([0-9a-f]{40})`/m);
if (!m) fail("Could not parse Upstream commit SHA from SCRATCH_PIN.md");
const expected = m[1];

let actual;
try {
  actual = execFileSync("git", ["-C", vendor, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
} catch {
  fail("git rev-parse failed in vendor/scratch-editor");
}

if (actual !== expected) {
  fail(`SHA mismatch: expected ${expected}, got ${actual}`);
}

const status = execFileSync("git", ["-C", vendor, "status", "--porcelain"], {
  encoding: "utf8",
});
if (status.trim().length > 0) {
  fail(`vendor/scratch-editor is dirty:\n${status}`);
}

console.log(`[gate0:check-pin] OK: ${actual}`);
