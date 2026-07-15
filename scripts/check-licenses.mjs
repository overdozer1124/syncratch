#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const inv = join(root, "docs", "gate0", "LICENSE_INVENTORY.md");

if (!existsSync(inv)) {
  console.error("[gate0:check-licenses] FAIL: LICENSE_INVENTORY.md missing");
  process.exit(1);
}

const text = readFileSync(inv, "utf8");
const required = [
  "scratch-editor",
  "scratch-vm",
  "AGPL",
  "@blocksync/project-schema",
  "@blocksync/google-identity",
];

const missing = required.filter((r) => !text.includes(r));
if (missing.length) {
  console.error(
    `[gate0:check-licenses] FAIL: missing mentions: ${missing.join(", ")}`,
  );
  process.exit(1);
}

console.log("[gate0:check-licenses] OK");
