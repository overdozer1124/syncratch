/**
 * @experimental R1 content-addressed asset store (Design §4.5).
 */

import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import {
  assertPathContained,
  assertSha256Hex,
  ensureQuarantineDirectory,
  lstatSafe,
  PathSafetyError,
  readFileNoFollow,
  resolveContainedPath,
  validateAssetsRoot,
  validateSubdirectory,
} from "./path-safety.js";
import { writeAllBytesSync } from "./write-bytes.js";

export { writeAllBytesSync, __setWriteSyncForTests } from "./write-bytes.js";

export {
  InvalidSha256Error,
  PathSafetyError,
  SHA256_HEX_PATTERN,
  assertPathContained,
  assertSha256Hex,
  lstatSafe,
  readFileNoFollow,
  resolveContainedPath,
  validateAssetsRoot,
  validateSubdirectory,
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

export class AssetTmpHashMismatchError extends Error {
  constructor() {
    super("ASSET_TMP_HASH_MISMATCH");
    this.name = "AssetTmpHashMismatchError";
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

function safeUnlink(path: string): void {
  try {
    if (existsSync(path)) {
      unlinkSync(path);
    }
  } catch {
    // Best-effort cleanup after failed publish.
  }
}

function readLiveBytes(rootReal: string, path: string): Uint8Array {
  const st = lstatSafe(path);
  resolveContainedPath(rootReal, path);
  if (!st.isFile()) {
    throw new PathSafetyError(`NOT_A_FILE:${path}`);
  }
  const size = Number(st.size);
  return new Uint8Array(readFileNoFollow(rootReal, path, size));
}

interface SessionContext {
  rootReal: string;
  quarantineDir: string;
}

export function createAssetFsStore(assetsRoot: string): AssetFsStore {
  mkdirSync(assetsRoot, { recursive: true });
  const pinnedRootReal = validateAssetsRoot(assetsRoot);
  const quarantineDir = join(assetsRoot, ".quarantine");
  ensureQuarantineDirectory(pinnedRootReal, quarantineDir);

  function refreshSession(): SessionContext {
    const rootReal = validateAssetsRoot(assetsRoot);
    if (rootReal !== pinnedRootReal) {
      throw new PathSafetyError(`ASSETS_ROOT_REALPATH_CHANGED:${assetsRoot}`);
    }
    const qDir = join(assetsRoot, ".quarantine");
    validateSubdirectory(rootReal, qDir);
    return { rootReal, quarantineDir: qDir };
  }

  function verifyExistingFinal(
    rootReal: string,
    finalPath: string,
    sha256: string,
  ): PutIfAbsentResult {
    const existing = readLiveBytes(rootReal, finalPath);
    if (contentSha256(existing) !== sha256) {
      throw new AssetFinalHashMismatchError();
    }
    return { wrote: false };
  }

  function verifyTmpBeforePublish(
    rootReal: string,
    tmpPath: string,
    sha256: string,
  ): void {
    const st = lstatSafe(tmpPath);
    assertPathContained(rootReal, tmpPath);
    if (!st.isFile()) {
      throw new PathSafetyError(`NOT_A_FILE:${tmpPath}`);
    }
    const size = Number(st.size);
    const onDisk = new Uint8Array(readFileNoFollow(rootReal, tmpPath, size));
    if (contentSha256(onDisk) !== sha256) {
      throw new AssetTmpHashMismatchError();
    }
  }

  function publishTmpToFinal(
    ctx: SessionContext,
    tmpPath: string,
    finalPath: string,
    sha256: string,
  ): PutIfAbsentResult {
    refreshSession();
    lstatSafe(tmpPath);
    assertPathContained(ctx.rootReal, tmpPath);
    assertPathContained(ctx.rootReal, finalPath);
    verifyTmpBeforePublish(ctx.rootReal, tmpPath, sha256);

    try {
      linkSync(tmpPath, finalPath);
      safeUnlink(tmpPath);
      return { wrote: true };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      safeUnlink(tmpPath);
      if (code === "EEXIST" || code === "EPERM") {
        if (!existsSync(finalPath)) {
          throw err;
        }
        lstatSafe(finalPath);
        return verifyExistingFinal(ctx.rootReal, finalPath, sha256);
      }
      throw err;
    }
  }

  return {
    assetsRoot,
    quarantineDir,

    putIfAbsent(sha256, bytes) {
      assertSha256Hex(sha256);
      if (contentSha256(bytes) !== sha256) {
        throw new AssetBytesHashMismatchError();
      }

      const ctx = refreshSession();
      const finalPath = livePath(assetsRoot, sha256);

      if (existsSync(finalPath)) {
        lstatSafe(finalPath);
        assertPathContained(ctx.rootReal, finalPath);
        return verifyExistingFinal(ctx.rootReal, finalPath, sha256);
      }

      assertPathContained(ctx.rootReal, finalPath);

      const suffix = randomBytes(8).toString("hex");
      const tmpPath = join(assetsRoot, `${sha256}.${suffix}.tmp`);
      assertPathContained(ctx.rootReal, tmpPath);

      refreshSession();

      let tmpPathWritten = false;
      try {
        const fd = openSync(
          tmpPath,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
          0o600,
        );
        tmpPathWritten = true;
        try {
          writeAllBytesSync(fd, bytes);
          fsyncSync(fd);
        } finally {
          closeSync(fd);
        }
        return publishTmpToFinal(ctx, tmpPath, finalPath, sha256);
      } catch (err) {
        if (tmpPathWritten) {
          safeUnlink(tmpPath);
        }
        throw err;
      }
    },

    getLive(sha256) {
      const ctx = refreshSession();
      const path = livePath(assetsRoot, sha256);
      if (!existsSync(path)) return null;
      return readLiveBytes(ctx.rootReal, path);
    },

    getQuarantined(sha256) {
      const ctx = refreshSession();
      const path = quarantinePath(ctx.quarantineDir, sha256);
      if (!existsSync(path)) return null;
      return readLiveBytes(ctx.rootReal, path);
    },

    liveExists(sha256) {
      const ctx = refreshSession();
      const path = livePath(assetsRoot, sha256);
      if (!existsSync(path)) return false;
      lstatSafe(path);
      assertPathContained(ctx.rootReal, path);
      return true;
    },

    quarantineExists(sha256) {
      const ctx = refreshSession();
      const path = quarantinePath(ctx.quarantineDir, sha256);
      if (!existsSync(path)) return false;
      lstatSafe(path);
      assertPathContained(ctx.rootReal, path);
      return true;
    },

    moveLiveToQuarantine(sha256) {
      const ctx = refreshSession();
      const from = livePath(assetsRoot, sha256);
      const to = quarantinePath(ctx.quarantineDir, sha256);
      const liveHadFile = existsSync(from);
      const quarantineHadFile = existsSync(to);

      if (!liveHadFile) {
        return { moved: false, liveHadFile: false, quarantineHadFile };
      }

      lstatSafe(from);
      assertPathContained(ctx.rootReal, from);
      if (quarantineHadFile) {
        lstatSafe(to);
        assertPathContained(ctx.rootReal, to);
        throw new PathSafetyError(`QUARANTINE_TARGET_EXISTS:${to}`);
      }

      assertPathContained(ctx.rootReal, to);
      refreshSession();
      renameSync(from, to);
      return { moved: true, liveHadFile: true, quarantineHadFile: false };
    },

    deleteQuarantined(sha256) {
      const ctx = refreshSession();
      const path = quarantinePath(ctx.quarantineDir, sha256);
      if (!existsSync(path)) return false;
      lstatSafe(path);
      assertPathContained(ctx.rootReal, path);
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

/** Test helper: read live asset bytes without guards. */
export function readRawLiveAsset(assetsRoot: string, sha256: string): Uint8Array {
  assertSha256Hex(sha256);
  return new Uint8Array(readFileSync(join(assetsRoot, sha256)));
}
