import {
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  closeSync,
} from "node:fs";
import { basename, dirname, join, sep } from "node:path";

export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export class InvalidSha256Error extends Error {
  constructor(sha256: string) {
    super(`Invalid sha256: ${sha256}`);
    this.name = "InvalidSha256Error";
  }
}

export class PathSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PathSafetyError";
  }
}

export function assertSha256Hex(sha256: string): void {
  if (!SHA256_HEX_PATTERN.test(sha256)) {
    throw new InvalidSha256Error(sha256);
  }
}

function assertNotSymlink(st: { isSymbolicLink(): boolean }, path: string): void {
  if (st.isSymbolicLink()) {
    throw new PathSafetyError(`SYMLINK_NOT_ALLOWED:${path}`);
  }
}

function rootPrefix(rootReal: string): string {
  return rootReal.endsWith(sep) ? rootReal : `${rootReal}${sep}`;
}

/** Resolve a path under rootReal; existing paths use realpath, new files use parent realpath. */
export function resolveContainedPath(rootReal: string, candidatePath: string): string {
  if (existsSync(candidatePath)) {
    const resolved = realpathSync(candidatePath);
    if (!resolved.startsWith(rootPrefix(rootReal))) {
      throw new PathSafetyError(`PATH_ESCAPE:${candidatePath}`);
    }
    return resolved;
  }

  const parent = dirname(candidatePath);
  if (!existsSync(parent)) {
    throw new PathSafetyError(`PARENT_MISSING:${candidatePath}`);
  }
  const parentSt = lstatSync(parent);
  assertNotSymlink(parentSt, parent);
  const parentReal = realpathSync(parent);
  if (!parentReal.startsWith(rootPrefix(rootReal)) && parentReal !== rootReal) {
    throw new PathSafetyError(`PATH_ESCAPE:${parent}`);
  }
  const resolved = join(parentReal, basename(candidatePath));
  if (!resolved.startsWith(rootPrefix(rootReal))) {
    throw new PathSafetyError(`PATH_ESCAPE:${candidatePath}`);
  }
  return resolved;
}

export function lstatSafe(path: string): NonNullable<ReturnType<typeof lstatSync>> {
  const st = lstatSync(path);
  assertNotSymlink(st, path);
  return st;
}

/**
 * Validate assetsRoot per Design §4.5.2: directory, not symlink/reparse, realpath stable.
 * Returns canonical realpath of assetsRoot.
 */
export function validateAssetsRoot(assetsRoot: string): string {
  if (!existsSync(assetsRoot)) {
    throw new PathSafetyError(`ASSETS_ROOT_MISSING:${assetsRoot}`);
  }
  const st = lstatSync(assetsRoot);
  assertNotSymlink(st, assetsRoot);
  if (!st.isDirectory()) {
    throw new PathSafetyError(`ASSETS_ROOT_NOT_DIRECTORY:${assetsRoot}`);
  }
  return realpathSync(assetsRoot);
}

export function validateSubdirectory(rootReal: string, subdirPath: string): void {
  if (!existsSync(subdirPath)) {
    throw new PathSafetyError(`SUBDIRECTORY_MISSING:${subdirPath}`);
  }
  const st = lstatSafe(subdirPath);
  if (!st.isDirectory()) {
    throw new PathSafetyError(`NOT_DIRECTORY:${subdirPath}`);
  }
  resolveContainedPath(rootReal, subdirPath);
}

/** Assert candidate path (existing or not) resolves under rootReal via its parent chain. */
export function assertPathContained(rootReal: string, candidatePath: string): void {
  resolveContainedPath(rootReal, candidatePath);
}

/** Read file after lstat no-follow checks; uses O_NOFOLLOW when available (POSIX). */
export function readFileNoFollow(
  rootReal: string,
  path: string,
  byteLength: number,
): Buffer {
  lstatSafe(path);
  resolveContainedPath(rootReal, path);

  const noFollow = constants.O_NOFOLLOW;
  const flags =
    typeof noFollow === "number"
      ? constants.O_RDONLY | noFollow
      : constants.O_RDONLY;
  const fd = openSync(path, flags);
  try {
    const buf = Buffer.alloc(byteLength);
    const read = readSync(fd, buf, 0, byteLength, 0);
    if (read !== byteLength) {
      throw new PathSafetyError(`SHORT_READ:${path}`);
    }
    return buf;
  } finally {
    closeSync(fd);
  }
}

/** Create quarantine directory once at startup; fails if path is not a real directory. */
export function ensureQuarantineDirectory(
  rootReal: string,
  quarantinePath: string,
): void {
  if (!existsSync(quarantinePath)) {
    mkdirSync(quarantinePath, { recursive: false });
  }
  validateSubdirectory(rootReal, quarantinePath);
}
