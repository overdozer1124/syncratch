#!/usr/bin/env node
/**
 * Generate §6.6.1 opcode allow-list from vendor pin v14.1.0 / 7c172e…
 * Output: packages/sb3-tools/vendor/scratch-opcodes-v14.1.0.json
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const vendorRoot = join(repoRoot, "vendor/scratch-editor/packages");
const outPath = join(
  repoRoot,
  "packages/sb3-tools/vendor/scratch-opcodes-v14.1.0.json",
);

const VENDOR_PIN = "7c172e469eb3c21c1e6326ea6cccea60bc14e3a8";
const VENDOR_TAG = "v14.1.0";
const EXPECTED_UNIQUE = 208;

const ALLOWED_EXTENSION_IDS = [
  "music",
  "pen",
  "videoSensing",
  "text2speech",
  "translate",
];

const EXTENSION_DIRS = {
  music: "scratch3_music",
  pen: "scratch3_pen",
  videoSensing: "scratch3_video_sensing",
  text2speech: "scratch3_text2speech",
  translate: "scratch3_translate",
};

function read(path) {
  return readFileSync(path, "utf8");
}

/** Extract keys from `methodName () { return { ... }; }` blocks in VM sources. */
function extractMethodReturnKeys(text, methodName) {
  const marker = `${methodName} ()`;
  const start = text.indexOf(marker);
  if (start < 0) return [];
  const returnStart = text.indexOf("return {", start);
  if (returnStart < 0) return [];
  let i = returnStart + "return ".length;
  let depth = 0;
  let bodyStart = -1;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === "{") {
      if (depth === 0) bodyStart = i + 1;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        const body = text.slice(bodyStart, i);
        const keys = [];
        for (const line of body.split("\n")) {
          const prim = line.match(
            /^\s{12}([a-zA-Z0-9_]+):\s+(?:this\.|\(\)\s*=>)/,
          );
          const obj = line.match(/^\s{12}([a-zA-Z0-9_]+):\s+\{/);
          if (prim) keys.push(prim[1]);
          else if (obj) keys.push(obj[1]);
        }
        return keys;
      }
    }
  }
  return [];
}

function scanVmBlockFiles() {
  const blocksDir = join(vendorRoot, "scratch-vm/src/blocks");
  const opcodes = new Set();
  const files = [
    "scratch3_control.js",
    "scratch3_data.js",
    "scratch3_event.js",
    "scratch3_looks.js",
    "scratch3_motion.js",
    "scratch3_operators.js",
    "scratch3_procedures.js",
    "scratch3_sensing.js",
    "scratch3_sound.js",
  ];

  for (const file of files) {
    const text = read(join(blocksDir, file));
    for (const method of ["getPrimitives", "getHats", "getMonitored"]) {
      for (const key of extractMethodReturnKeys(text, method)) {
        opcodes.add(key);
      }
    }
  }
  return opcodes;
}

function scanPrimitiveOpcodeInfoMap() {
  const text = read(join(vendorRoot, "scratch-vm/src/serialization/sb3.js"));
  const match = text.match(
    /const primitiveOpcodeInfoMap = \{([\s\S]*?)\n\};/,
  );
  if (!match) throw new Error("primitiveOpcodeInfoMap not found in sb3.js");
  const opcodes = new Set();
  for (const line of match[1].split("\n")) {
    const m = line.match(/^\s{4}([a-zA-Z0-9_]+):/);
    if (m) opcodes.add(m[1]);
  }
  return opcodes;
}

function scanToolboxXml() {
  const text = read(join(vendorRoot, "scratch-gui/src/lib/make-toolbox-xml.js"));
  const opcodes = new Set();
  const re = /type="([a-zA-Z0-9_]+)"/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    opcodes.add(m[1]);
  }
  return opcodes;
}

function scanRuntimeShadowOpcodes() {
  const text = read(join(vendorRoot, "scratch-vm/src/engine/runtime.js"));
  const opcodes = new Set();
  for (const m of text.matchAll(
    /shadow:\s*\{\s*\n\s*type:\s*'([a-zA-Z0-9_]+)'/g,
  )) {
    opcodes.add(m[1]);
  }
  return opcodes;
}

function scanExtensionMenus(text, extensionId) {
  const opcodes = new Set();
  const menusIdx = text.indexOf("menus:");
  if (menusIdx < 0) return opcodes;
  const slice = text.slice(menusIdx, menusIdx + 2000);
  for (const m of slice.matchAll(/^\s+([A-Za-z0-9_]+):\s*\{/gm)) {
    opcodes.add(`${extensionId}_menu_${m[1]}`);
  }
  return opcodes;
}

function scanExtension(extensionId, dirName) {
  const path = join(vendorRoot, `scratch-vm/src/extensions/${dirName}/index.js`);
  const text = read(path);
  const opcodes = new Set();

  const returnMatch = text.match(
    /getInfo\s*\(\s*\)\s*\{[\s\S]*?return\s*\{\s*\n\s*id:\s*'([^']+)'/,
  );
  if (!returnMatch || returnMatch[1] !== extensionId) {
    throw new Error(
      `Extension ${dirName}: expected id ${extensionId}, got ${returnMatch?.[1] ?? "none"}`,
    );
  }

  for (const m of text.matchAll(/opcode:\s*'([^']+)'/g)) {
    opcodes.add(`${extensionId}_${m[1]}`);
  }

  for (const menuOpcode of scanExtensionMenus(text, extensionId)) {
    opcodes.add(menuOpcode);
  }

  return opcodes;
}

function generate({ skipCountCheck = false } = {}) {
  const opcodes = new Set();

  for (const o of scanVmBlockFiles()) opcodes.add(o);
  for (const o of scanPrimitiveOpcodeInfoMap()) opcodes.add(o);
  for (const o of scanToolboxXml()) opcodes.add(o);
  for (const o of scanRuntimeShadowOpcodes()) opcodes.add(o);

  // SB3-only block (Design §6.6.1 #5)
  opcodes.add("procedures_prototype");

  // Hexagonal boolean shadow (§6.6.3 toolbox shadows; not in make-toolbox-xml.js)
  opcodes.add("boolean");

  for (const [extId, dir] of Object.entries(EXTENSION_DIRS)) {
    for (const o of scanExtension(extId, dir)) opcodes.add(o);
  }

  const sorted = [...opcodes].sort();
  if (!skipCountCheck && sorted.length !== EXPECTED_UNIQUE) {
    const designPath = join(
      repoRoot,
      "docs/superpowers/specs/2026-07-16-r1-scratch-sb3-design.md",
    );
    const design = read(designPath);
    const section = design.split("#### 6.6.3")[1] ?? "";
    const expected = new Set();
    for (const m of section.matchAll(/`([a-zA-Z0-9_]+)`/g)) {
      if (m[1].includes("_") || /^[a-z]/.test(m[1])) expected.add(m[1]);
    }
    const missing = [...expected].filter((o) => !opcodes.has(o)).sort();
    const extra = sorted.filter((o) => !expected.has(o)).sort();
    console.error(`Missing (${missing.length}):`, missing.join(", "));
    console.error(`Extra (${extra.length}):`, extra.join(", "));
    throw new Error(
      `Expected ${EXPECTED_UNIQUE} unique opcodes, got ${sorted.length}`,
    );
  }

  return {
    vendorTag: VENDOR_TAG,
    vendorPin: VENDOR_PIN,
    generatedAt: new Date().toISOString(),
    allowedExtensionIds: ALLOWED_EXTENSION_IDS,
    opcodes: sorted,
  };
}

function main() {
  const artifact = generate();
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Wrote ${artifact.opcodes.length} opcodes to ${outPath}`);
}

const isCheck = process.argv.includes("--check");
const isList = process.argv.includes("--list");

if (isList) {
  const { opcodes } = generate({ skipCountCheck: true });
  console.log(JSON.stringify(opcodes, null, 2));
  process.exit(0);
}

if (isCheck) {
  const generated = generate();
  const existing = JSON.parse(read(outPath));
  const genJson = JSON.stringify(generated.opcodes);
  const existJson = JSON.stringify(existing.opcodes);
  if (genJson !== existJson) {
    console.error("Opcode artifact is stale — run: node scripts/generate-scratch-opcodes.mjs");
    process.exit(1);
  }
  if (existing.opcodes.length !== EXPECTED_UNIQUE) {
    console.error(`Artifact must contain ${EXPECTED_UNIQUE} opcodes`);
    process.exit(1);
  }
  console.log(`scratch-opcodes-v14.1.0.json OK (${EXPECTED_UNIQUE} opcodes)`);
} else {
  main();
}
