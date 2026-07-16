/**
 * Isolated SB3 loader worker — run under a capped V8 heap suggestion so
 * inflate bombs cannot grow the parent process. Reads spool from
 * GATE0_SB3_SPOOL_PATH or stdin; writes verified assets to GATE0_SB3_HOLDING_DIR.
 */
import {
  closeSync,
  constants,
  openSync,
} from "node:fs";
import { join } from "node:path";
import {
  assertPathContained,
  assertSha256Hex,
  lstatSafe,
  readFileNoFollow,
  validateSubdirectory,
  writeAllBytesSync,
} from "@blocksync/project-assets-fs";
import {
  canonicalDataFormat,
  loadSb3,
} from "./index.ts";

const DEFAULT_HOLDING_BUDGET_BYTES = 33_554_432;

function testHooksAllowed() {
  return process.env.NODE_ENV === "test" || process.env.GATE0_TEST_HOOKS === "1";
}

function parsePositiveInt(raw, fallback) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return Math.floor(value);
}

function writeHoldingAssetNoFollow(
  rootReal,
  holdingDir,
  sha256,
  bytes,
) {
  assertSha256Hex(sha256);
  validateSubdirectory(rootReal, holdingDir);
  const path = join(holdingDir, sha256);
  assertPathContained(rootReal, path);
  const noFollow =
    typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
    0o600,
  );
  try {
    writeAllBytesSync(fd, bytes);
  } finally {
    closeSync(fd);
  }
}

function readSpoolNoFollow(
  rootReal,
  spoolPath,
  maxBytes,
) {
  assertPathContained(rootReal, spoolPath);
  const st = lstatSafe(spoolPath);
  if (!st.isFile()) {
    throw new Error(`SPOOL_NOT_FILE:${spoolPath}`);
  }
  const size = Number(st.size);
  if (size > maxBytes) {
    throw new Error(`SPOOL_CAP_EXCEEDED:${maxBytes}`);
  }
  return Buffer.from(readFileNoFollow(rootReal, spoolPath, size));
}

const holdMs = Number(process.env.GATE0_SB3_WORKER_HOLD_MS || 0);
if (Number.isFinite(holdMs) && holdMs > 0) {
  if (!testHooksAllowed()) {
    process.stderr.write(
      "GATE0_SB3_WORKER_HOLD_MS ignored outside test env\n",
    );
  } else {
    await new Promise((r) => setTimeout(r, holdMs));
  }
}

const manifestHoldMs = Number(process.env.GATE0_SB3_MANIFEST_HOLD_MS || 0);

const rootReal = process.env.GATE0_SB3_DATA_ROOT_REAL;
const spoolPath = process.env.GATE0_SB3_SPOOL_PATH;
const holdingDir = process.env.GATE0_SB3_HOLDING_DIR;
const holdingBudgetBytes = parsePositiveInt(
  process.env.GATE0_SB3_HOLDING_BUDGET_BYTES,
  DEFAULT_HOLDING_BUDGET_BYTES,
);

const limits = process.env.GATE0_SB3_LIMITS
  ? JSON.parse(process.env.GATE0_SB3_LIMITS)
  : undefined;
const maxSpoolBytes = limits?.maxBytes ?? 33_554_432;

let bytes;
if (spoolPath) {
  if (!rootReal) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        warnings: [],
        issues: [
          {
            code: "TOO_LARGE",
            message: "GATE0_SB3_DATA_ROOT_REAL required with spool path",
          },
        ],
      }),
    );
    process.exit(1);
  }
  bytes = readSpoolNoFollow(rootReal, spoolPath, maxSpoolBytes);
} else {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  bytes = Buffer.concat(chunks);
}

function writeManifestAssets(document, assets) {
  if (!holdingDir) {
    return { ok: false, message: "GATE0_SB3_HOLDING_DIR required" };
  }
  if (!rootReal) {
    return { ok: false, message: "GATE0_SB3_DATA_ROOT_REAL required" };
  }
  validateSubdirectory(rootReal, holdingDir);
  const manifestAssets = [];
  const seen = new Set();
  let holdingBytesWritten = 0;
  for (const target of document.targets) {
    for (const costume of target.costumes ?? []) {
      if (seen.has(costume.contentSha256)) continue;
      seen.add(costume.contentSha256);
      const file = assets.get(costume.md5ext);
      if (!file) {
        return { ok: false, message: `MISSING_ASSET:${costume.md5ext}` };
      }
      if (holdingBytesWritten + file.byteLength > holdingBudgetBytes) {
        return { ok: false, message: "HOLDING_BUDGET_EXCEEDED" };
      }
      writeHoldingAssetNoFollow(
        rootReal,
        holdingDir,
        costume.contentSha256,
        file,
      );
      holdingBytesWritten += file.byteLength;
      manifestAssets.push({
        sha256: costume.contentSha256,
        byteLength: file.byteLength,
        md5Hex: costume.assetId,
        dataFormat: canonicalDataFormat(costume.dataFormat),
      });
    }
    for (const sound of target.sounds ?? []) {
      if (seen.has(sound.contentSha256)) continue;
      seen.add(sound.contentSha256);
      const file = assets.get(sound.md5ext);
      if (!file) {
        return { ok: false, message: `MISSING_ASSET:${sound.md5ext}` };
      }
      if (holdingBytesWritten + file.byteLength > holdingBudgetBytes) {
        return { ok: false, message: "HOLDING_BUDGET_EXCEEDED" };
      }
      writeHoldingAssetNoFollow(
        rootReal,
        holdingDir,
        sound.contentSha256,
        file,
      );
      holdingBytesWritten += file.byteLength;
      manifestAssets.push({
        sha256: sound.contentSha256,
        byteLength: file.byteLength,
        md5Hex: sound.assetId,
        dataFormat: canonicalDataFormat(sound.dataFormat),
      });
    }
  }
  return { ok: true, assets: manifestAssets, holdingBytesWritten };
}

try {
  const result = await loadSb3(new Uint8Array(bytes), limits);
  if (!result.ok || !result.document || !result.assets) {
    const { assets: _a, ...rest } = result;
    process.stdout.write(JSON.stringify(rest));
    process.exit(result.ok ? 0 : 2);
  }

  if (Number.isFinite(manifestHoldMs) && manifestHoldMs > 0) {
    if (!testHooksAllowed()) {
      process.stderr.write(
        "GATE0_SB3_MANIFEST_HOLD_MS ignored outside test env\n",
      );
    } else {
      await new Promise((r) => setTimeout(r, manifestHoldMs));
    }
  }

  const manifestResult = writeManifestAssets(result.document, result.assets);
  if (!manifestResult.ok) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        warnings: result.warnings ?? [],
        issues: [
          {
            code: "MISSING_ASSET",
            message: manifestResult.message,
          },
        ],
      }),
    );
    process.exit(2);
  }

  const { assets: _a, ...rest } = result;
  process.stdout.write(
    JSON.stringify({
      ...rest,
      manifest: {
        assets: manifestResult.assets,
        holdingBytesWritten: manifestResult.holdingBytesWritten,
      },
    }),
  );
  process.exit(0);
} catch (e) {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      warnings: [],
      issues: [
        {
          code: "TOO_LARGE",
          message: e instanceof Error ? e.message : String(e),
        },
      ],
    }),
  );
  process.exit(1);
}
