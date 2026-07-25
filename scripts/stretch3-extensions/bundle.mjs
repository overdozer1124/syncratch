#!/usr/bin/env node
/**
 * Bundle Stretch3 builtin-injected extensions into Xcratch-style ESM modules
 * (`export { blockClass, entry }`) for Syncratch's extension gallery.
 *
 * Sources are shallow-cloned into .cache/stretch3-extensions/ (gitignored).
 * Output: apps/editor-web/public/extensions/<id>.mjs
 */
import {spawnSync} from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import {createRequire} from "node:module";
import {dirname, join, relative} from "node:path";
import {fileURLToPath} from "node:url";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const requireFromBundlePkg = createRequire(join(__dirname, "package.json"));
const repoRoot = join(__dirname, "../..");
const cacheRoot = join(repoRoot, ".cache/stretch3-extensions");
const workRoot = join(cacheRoot, "work");
const outDir = join(repoRoot, "apps/editor-web/public/extensions");
const vmSrc = join(
  repoRoot,
  "vendor/scratch-editor/packages/scratch-vm/src",
);

const BUNDLE_DEPS = [
  "jsqr",
  "encoding-japanese",
  "firebase/app",
  "firebase/firestore",
];

/** @type {Array<{
 *   id: string;
 *   repo: string;
 *   sourcePath: string;
 *   name: string;
 *   needsMl5?: boolean;
 *   preamble?: string;
 * }>} */
const EXTENSIONS = [
  {
    id: "iftttWebhooks",
    repo: "https://github.com/NorifumiOgawa/iftttWebhooks.git",
    sourcePath:
      "scratch-vm/src/extensions/scratch3_iftttWebhooks/index.js",
    name: "IFTTT Webhooks",
  },
  {
    id: "tm2scratch",
    repo: "https://github.com/champierre/tm2scratch.git",
    sourcePath: "scratch-vm/src/extensions/scratch3_tm2scratch/index.js",
    name: "TM2Scratch",
  },
  {
    id: "tmpose2scratch",
    repo: "https://github.com/champierre/tmpose2scratch.git",
    sourcePath:
      "scratch-vm/src/extensions/scratch3_tmpose2scratch/index.js",
    name: "TMPose2Scratch",
  },
  {
    id: "scratch2maqueen",
    repo: "https://github.com/champierre/scratch2maqueen.git",
    sourcePath:
      "scratch-vm/src/extensions/scratch3_scratch2maqueen/index.js",
    name: "Scratch2Maqueen",
  },
  {
    id: "facemesh2scratch",
    repo: "https://github.com/champierre/facemesh2scratch.git",
    sourcePath:
      "scratch-vm/src/extensions/scratch3_facemesh2scratch/index.js",
    name: "Facemesh2Scratch",
    needsMl5: true,
  },
  {
    id: "handpose2scratch",
    repo: "https://github.com/champierre/handpose2scratch.git",
    sourcePath:
      "scratch-vm/src/extensions/scratch3_handpose2scratch/index.js",
    name: "Handpose2Scratch",
    needsMl5: true,
  },
  {
    id: "ic2scratch",
    repo: "https://github.com/champierre/ic2scratch.git",
    sourcePath: "scratch-vm/src/extensions/scratch3_ic2scratch/index.js",
    name: "ImageClassifier2Scratch",
    needsMl5: true,
  },
  {
    id: "pasorich",
    repo: "https://github.com/con3code/pasorich.git",
    sourcePath: "scratch-vm/src/extensions/scratch3_pasorich/index.js",
    name: "PaSoRich 2.0",
  },
  {
    id: "qrcode",
    repo: "https://github.com/sugiura-lab/scratch3-qrcode.git",
    sourcePath: "scratch-vm/src/extensions/scratch3_qrcode/index.js",
    name: "QR Code",
  },
  {
    id: "numberbank",
    repo: "https://github.com/con3code/numberbank.git",
    sourcePath: "scratch-vm/src/extensions/scratch3_numberbank/index.js",
    name: "NumberBank 2.0",
    preamble: "let extensionURL = null;\n",
  },
];

function run(cmd, args, cwd) {
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed`);
  }
}

function ensureDeps() {
  if (!existsSync(join(__dirname, "node_modules/esbuild"))) {
    console.log("[stretch3-ext] installing bundle dependencies…");
    run("pnpm", ["install"], __dirname);
  }
}

function cloneRepo(repo, dest) {
  if (existsSync(join(dest, ".git"))) {
    console.log(`[stretch3-ext] reuse ${relative(repoRoot, dest)}`);
    return;
  }
  mkdirSync(dirname(dest), {recursive: true});
  console.log(`[stretch3-ext] clone ${repo}`);
  run("git", ["clone", "--depth", "1", repo, dest], repoRoot);
}

function linkVmTree(workSrc) {
  mkdirSync(workSrc, {recursive: true});
  for (const dir of ["extension-support", "io", "engine"]) {
    const target = join(vmSrc, dir);
    const link = join(workSrc, dir);
    rmSync(link, {recursive: true, force: true});
    symlinkSync(target, link, "dir");
  }
  // util/log.js depends on tslog; point that file at our browser shim instead
  // of symlinking the whole util directory.
  const utilLink = join(workSrc, "util");
  rmSync(utilLink, {recursive: true, force: true});
  mkdirSync(utilLink, {recursive: true});
  for (const name of readdirSync(join(vmSrc, "util"))) {
    const dest = join(utilLink, name);
    if (name === "log.js") {
      symlinkSync(join(__dirname, "shims/log.cjs"), dest);
    } else if (name === "base64-util.js") {
      symlinkSync(join(__dirname, "shims/base64-util.cjs"), dest);
    } else {
      symlinkSync(join(vmSrc, "util", name), dest);
    }
  }
}

function writeEntry({id, name}) {
  const entryPath = join(workRoot, "entries", `${id}.js`);
  mkdirSync(dirname(entryPath), {recursive: true});
  // ESM entry that imports the CJS extension (esbuild converts CommonJS).
  writeFileSync(
    entryPath,
    `import BlockClassModule from "../src/extensions/scratch3_${id}/index.js";
const BlockClass = BlockClassModule?.default ?? BlockClassModule;
export const blockClass = BlockClass;
export const entry = {
  extensionId: ${JSON.stringify(id)},
  name: ${JSON.stringify(name)},
};
`,
  );
  return entryPath;
}

async function bundleOne(ext) {
  const repoName = ext.repo
    .split("/")
    .pop()
    .replace(/\.git$/, "");
  const repoDir = join(cacheRoot, "repos", repoName);
  cloneRepo(ext.repo, repoDir);

  const sourceFile = join(repoDir, ext.sourcePath);
  if (!existsSync(sourceFile)) {
    throw new Error(`missing source: ${sourceFile}`);
  }

  const extDir = join(workRoot, "src/extensions", `scratch3_${ext.id}`);
  mkdirSync(extDir, {recursive: true});
  let source = readFileSync(sourceFile, "utf8");
  if (ext.preamble && !source.includes("let extensionURL")) {
    source = `${ext.preamble}${source}`;
  }
  // Some Stretch3 extensions reassign formatMessage from runtime.
  source = source.replace(
    /const formatMessage = require\(['"]format-message['"]\);/,
    "let formatMessage = require('format-message');",
  );
  writeFileSync(join(extDir, "index.js"), source);

  const entryPath = writeEntry(ext);
  const outfile = join(outDir, `${ext.id}.mjs`);

  /** @type {Record<string, string>} */
  const alias = {
    "format-message": join(__dirname, "shims/format-message-setup.cjs"),
    atob: join(__dirname, "shims/atob.cjs"),
    btoa: join(__dirname, "shims/btoa.cjs"),
    tslog: join(__dirname, "shims/log.cjs"),
    "@peculiar/webcrypto": join(__dirname, "shims/peculiar-webcrypto.cjs"),
  };
  if (ext.needsMl5) {
    alias.ml5 = join(__dirname, "shims/ml5.cjs");
  }
  for (const dep of BUNDLE_DEPS) {
    alias[dep] = requireFromBundlePkg.resolve(dep);
  }

  /** @type {import('esbuild').Plugin} */
  const relativeShimPlugin = {
    name: "stretch3-relative-shims",
    setup(build) {
      build.onResolve({filter: /util\/log(?:\.js)?$/}, () => ({
        path: join(__dirname, "shims/log.cjs"),
      }));
      build.onResolve({filter: /engine\/variable(?:\.js)?$/}, () => ({
        path: join(__dirname, "shims/variable.cjs"),
      }));
    },
  };

  await esbuild.build({
    entryPoints: [entryPath],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2020"],
    outfile,
    logLevel: "warning",
    alias,
    plugins: [relativeShimPlugin],
    // Keep Node built-ins out; browser extensions must not require them.
    mainFields: ["browser", "module", "main"],
    conditions: ["browser", "import", "default"],
    define: {
      "process.env.NODE_ENV": '"production"',
      global: "globalThis",
    },
    banner: {
      js: `/* Syncratch bundled Stretch3 extension: ${ext.id}
 * Upstream: ${ext.repo}
 * Regenerated by: node scripts/stretch3-extensions/bundle.mjs
 */
`,
    },
  });

  // Verify named exports exist by parsing the file header/footer lightly.
  const out = readFileSync(outfile, "utf8");
  if (!out.includes("blockClass")) {
    throw new Error(`${ext.id}: bundle missing blockClass export`);
  }
  const sizeKb = Math.round(out.length / 1024);
  console.log(`[stretch3-ext] wrote ${relative(repoRoot, outfile)} (${sizeKb} KiB)`);
}

async function main() {
  ensureDeps();
  if (!existsSync(vmSrc)) {
    throw new Error(`scratch-vm source missing: ${vmSrc}`);
  }
  mkdirSync(outDir, {recursive: true});
  mkdirSync(workRoot, {recursive: true});
  linkVmTree(join(workRoot, "src"));

  // Resolve bundle deps from this package's node_modules.
  process.chdir(__dirname);

  for (const ext of EXTENSIONS) {
    await bundleOne(ext);
  }

  // Manifest for humans / tests
  const manifest = {
    generatedAt: new Date().toISOString(),
    extensions: EXTENSIONS.map(ext => ({
      id: ext.id,
      url: `extensions/${ext.id}.mjs`,
      needsMl5: Boolean(ext.needsMl5),
      upstream: ext.repo,
    })),
  };
  writeFileSync(
    join(outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log("[stretch3-ext] done");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
