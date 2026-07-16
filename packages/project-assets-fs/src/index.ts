/**
 * @experimental R1 content-addressed asset store (Design §4.5).
 */

import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import {
  assertSha256Hex,
  lstatSafe,
  PathSafetyError,
  readFileNoFollow,
  resolveContainedPath,
  validateAssetsRoot,
  validateSubdirectory,
} from "./path-safety.js";

export {
  InvalidSha256Error,
  PathSafetyError,
  SHA256_HEX_PATTERN,
  assertSha256Hex,
  validateAssetsRoot,
} from "./path-safety.js";

export class AssetBytesHashMismatchError extends Error {
  constructor() {
    super("ASSET_BYTES_HASH_MISMATCH");
    this.name = "AssetBytesHashMismatchError";
  }
}

export class AssetFinalHashMismatchError extends Error {
  constructor() {
    super("ASSET_FINAL_HASH_MISMATCH");
    this.name = "AssetFinalHashMismatchError";
  }
}

export function contentSha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface PutIfAbsentResult {
  /** False when an existing live object with the same bytes was reused. */
  wrote: boolean;
}

export interface MoveToQuarantineResult {
  moved: boolean;
  liveHadFile: boolean;
  quarantineHadFile: boolean;
}

export interface AssetFsStore {
  readonly assetsRoot: string;
  readonly quarantineDir: string;
  putIfAbsent(sha256: string, bytes: Uint8Array): PutIfAbsentResult;
  getLive(sha256: string): Uint8Array | null;
  getQuarantined(sha256: string): Uint8Array | null;
  liveExists(sha256: string): boolean;
  quarantineExists(sha256: string): boolean;
  /** Rename live → .quarantine/{sha256} without following symlinks (§9.4). */
  moveLiveToQuarantine(sha256: string): MoveToQuarantineResult;
  deleteQuarantined(sha256: string): boolean;
}

function livePath(assetsRoot: string, sha256: string): string {
  assertSha256Hex(sha256);
  return join(assetsRoot, sha256);
}

function quarantinePath(quarantineDir: string, sha256: string): string {
  assertSha256Hex(sha256);
  return join(quarantineDir, sha256);
}

function readLiveBytes(
  rootReal: string,
  path: string,
): Uint8Array {
  const st = lstatSafe(path);
  resolveContainedPath(rootReal, path);
  if (!st.isFile()) {
    throw new PathSafetyError(`NOT_A_FILE:${path}`);
  }
  const size = Number(st.size);
  return new Uint8Array(readFileNoFollow(rootReal, path, size));
}

export function createAssetFsStore(assetsRoot: string): AssetFsStore {
  mkdirSync(assetsRoot, { recursive: true });
  const rootReal = validateAssetsRoot(assetsRoot);
  const quarantineDir = join(assetsRoot, ".quarantine");
  mkdirSync(quarantineDir, { recursive: true });
  validateSubdirectory(rootReal, quarantineDir);

  function assertLivePath(sha256: string): string {
    const path = livePath(assetsRoot, sha256);
    if (existsSync(path)) {
      lstatSafe(path);
      resolveContainedPath(rootReal, path);
    }
    return path;
  }

  function assertQuarantinePath(sha256: string): string {
    const path = quarantinePath(quarantineDir, sha256);
    if (existsSync(path)) {
      lstatSafe(path);
      resolveContainedPath(rootReal, path);
    }
    return path;
  }

  return {
    assetsRoot,
    quarantineDir,

    putIfAbsent(sha256, bytes) {
      assertSha256Hex(sha256);
      if (contentSha256(bytes) !== sha256) {
        throw new AssetBytesHashMismatchError();
      }

      const finalPath = assertLivePath(sha256);
      if (existsSync(finalPath)) {
        const existing = readLiveBytes(rootReal, finalPath);
        if (contentSha256(existing) !== sha256) {
          throw new AssetFinalHashMismatchError();
        }
        return { wrote: false };
      }

      const suffix = randomBytes(8).toString("hex");
      const tmpPath = join(assetsRoot, `${sha256}.${suffix}.tmp`);
      const fd = openSync(tmpPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      try {
        writeSync(fd, bytes);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }

      if (existsSync(finalPath)) {
        unlinkSync(tmpPath);
        const existing = readLiveBytes(rootReal, finalPath);
        if (contentSha256(existing) !== sha256) {
          throw new AssetFinalHashMismatchError();
        }
        return { wrote: false };
      }

      lstatSafe(tmpPath);
      resolveContainedPath(rootReal, tmpPath);
      renameSync(tmpPath, finalPath);
      return { wrote: true };
    },

    getLive(sha256) {
      const path = assertLivePath(sha256);
      if (!existsSync(path)) return null;
      return readLiveBytes(rootReal, path);
    },

    getQuarantined(sha256) {
      const path = assertQuarantinePath(sha256);
      if (!existsSync(path)) return null;
      return readLiveBytes(rootReal, path);
    },

    liveExists(sha256) {
      const path = livePath(assetsRoot, sha256);
      if (!existsSync(path)) return false;
      lstatSafe(path);
      resolveContainedPath(rootReal, path);
      return true;
    },

    quarantineExists(sha256) {
      const path = quarantinePath(quarantineDir, sha256);
      if (!existsSync(path)) return false;
      lstatSafe(path);
      resolveContainedPath(rootReal, path);
      return true;
    },

    moveLiveToQuarantine(sha256) {
      const from = assertLivePath(sha256);
      const to = quarantinePath(quarantineDir, sha256);
      const liveHadFile = existsSync(from);
      const quarantineHadFile = existsSync(to);

      if (!liveHadFile) {
        return { moved: false, liveHadFile: false, quarantineHadFile };
      }

      lstatSafe(from);
      resolveContainedPath(rootReal, from);
      if (quarantineHadFile) {
        lstatSafe(to);
        resolveContainedPath(rootReal, to);
        throw new PathSafetyError(`QUARANTINE_TARGET_EXISTS:${to}`);
      }

      mkdirSync(quarantineDir, { recursive: true });
      renameSync(from, to);
      return { moved: true, liveHadFile: true, quarantineHadFile: false };
    },

    deleteQuarantined(sha256) {
      const path = assertQuarantinePath(sha256);
      if (!existsSync(path)) return false;
      lstatSafe(path);
      resolveContainedPath(rootReal, path);
      unlinkSync(path);
      return true;
    },
  };
}

/** Test helper: write bytes at live path without putIfAbsent guards. */
export function writeRawLiveAsset(
  assetsRoot: string,
  sha256: string,
  bytes: Uint8Array,
): void {
  mkdirSync(assetsRoot, { recursive: true });
  assertSha256Hex(sha256);
  const path = join(assetsRoot, sha256);
  const fd = openSync(path, "w");
  try {
    writeSync(fd, bytes);
  } finally {
    closeSync(fd);
  }
}

/** Test helper: corrupt live asset bytes in place. */
export function readRawLiveAsset(assetsRoot: string, sha256: string): Uint8Array {
  assertSha256Hex(sha256);
  return new Uint8Array(readFileSync(join(assetsRoot, sha256)));
}
