#!/usr/bin/env node
/**
 * npm @scratch/scratch-vm@14.1.0 references browser/default-stylesheet.css
 * which is missing from the published tarball. Create an empty stub beside the
 * installed package so headless Node can construct VirtualMachine.
 * This does NOT modify vendor/scratch-editor sources.
 */
import { existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, "..");
const repoRoot = join(pkgDir, "..", "..");
const require = createRequire(join(pkgDir, "package.json"));

function resolveVmRoot() {
  try {
    return dirname(require.resolve("@scratch/scratch-vm/package.json"));
  } catch {
    // pnpm nested store fallback
    const pnpm = join(repoRoot, "node_modules", ".pnpm");
    if (!existsSync(pnpm)) return null;
    for (const entry of readdirSync(pnpm)) {
      if (!entry.startsWith("@scratch+scratch-vm@")) continue;
      const candidate = join(
        pnpm,
        entry,
        "node_modules",
        "@scratch",
        "scratch-vm",
      );
      if (existsSync(join(candidate, "package.json"))) return candidate;
    }
    return null;
  }
}

const pkgRoot = resolveVmRoot();
if (!pkgRoot) {
  console.warn("[scratch-adapter] @scratch/scratch-vm not found; skip css stub");
  process.exit(0);
}

const cssPath = join(pkgRoot, "browser", "default-stylesheet.css");
if (!existsSync(cssPath)) {
  mkdirSync(dirname(cssPath), { recursive: true });
  writeFileSync(cssPath, "/* Gate0 stub for missing published asset */\n", "utf8");
  console.log("[scratch-adapter] wrote stub", cssPath);
} else {
  console.log("[scratch-adapter] css present", cssPath);
}
