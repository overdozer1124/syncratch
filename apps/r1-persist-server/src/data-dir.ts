import {
  closeSync,
  constants,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  rmSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import type { Readable } from "node:stream";
import {
  PathSafetyError,
  assertPathContained,
  assertSha256Hex,
  lstatSafe,
  readFileNoFollow,
  resolveContainedPath,
  validateAssetsRoot,
  validateSubdirectory,
  writeAllBytesSync,
} from "@blocksync/project-assets-fs";

export interface R1DataLayout {
  root: string;
  rootReal: string;
  assets: string;
  importSpool: string;
  importHolding: string;
  workerTemp: string;
}

function ensureDirectory(rootReal: string, dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: false });
  }
  validateSubdirectory(rootReal, dirPath);
}

/** Pin R1_DATA_DIR and validate subdirectories per Design §4.5. */
export function createR1DataLayout(root: string): R1DataLayout {
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true });
  }
  const rootReal = validateAssetsRoot(root);
  const layout: R1DataLayout = {
    root,
    rootReal,
    assets: join(root, "assets"),
    importSpool: join(root, "import-spool"),
    importHolding: join(root, "import-holding"),
    workerTemp: join(root, "worker-temp"),
  };
  for (const dir of [
    layout.importSpool,
    layout.importHolding,
    layout.workerTemp,
  ]) {
    ensureDirectory(rootReal, dir);
  }
  return layout;
}

export function refreshR1DataLayout(layout: R1DataLayout): R1DataLayout {
  const rootReal = validateAssetsRoot(layout.root);
  if (rootReal !== layout.rootReal) {
    throw new PathSafetyError(`R1_DATA_DIR_REALPATH_CHANGED:${layout.root}`);
  }
  for (const dir of [
    layout.importSpool,
    layout.importHolding,
    layout.workerTemp,
  ]) {
    validateSubdirectory(rootReal, dir);
  }
  return layout;
}

export function sessionSpoolPath(
  layout: R1DataLayout,
  importSessionId: string,
): string {
  return join(layout.importSpool, `${importSessionId}.zip`);
}

export function sessionHoldingDir(
  layout: R1DataLayout,
  importSessionId: string,
): string {
  return join(layout.importHolding, importSessionId);
}

export function sessionWorkerTempDir(
  layout: R1DataLayout,
  importSessionId: string,
): string {
  return join(layout.workerTemp, importSessionId);
}

export function prepareSessionDirs(
  layout: R1DataLayout,
  importSessionId: string,
): { holdingDir: string; workerTempDir: string } {
  const ctx = refreshR1DataLayout(layout);
  const holdingDir = sessionHoldingDir(ctx, importSessionId);
  const workerTempDir = sessionWorkerTempDir(ctx, importSessionId);
  if (!existsSync(holdingDir)) {
    mkdirSync(holdingDir, { recursive: false });
  }
  validateSubdirectory(ctx.rootReal, holdingDir);
  if (!existsSync(workerTempDir)) {
    mkdirSync(workerTempDir, { recursive: false });
  }
  validateSubdirectory(ctx.rootReal, workerTempDir);
  return { holdingDir, workerTempDir };
}

export function openSpoolWriteNoFollow(
  layout: R1DataLayout,
  importSessionId: string,
): { fd: number; path: string } {
  const ctx = refreshR1DataLayout(layout);
  const path = sessionSpoolPath(ctx, importSessionId);
  assertPathContained(ctx.rootReal, path);
  validateSubdirectory(ctx.rootReal, ctx.importSpool);
  const noFollow =
    typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollow,
    0o600,
  );
  return { fd, path };
}

export async function streamToSpoolNoFollow(
  layout: R1DataLayout,
  importSessionId: string,
  source: Readable,
  maxBytes: number,
): Promise<number> {
  const { fd, path } = openSpoolWriteNoFollow(layout, importSessionId);
  let written = 0;
  try {
    for await (const chunk of source) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (written + buf.length > maxBytes) {
        throw new RangeError(`SPOOL_CAP_EXCEEDED:${maxBytes}`);
      }
      writeAllBytesSync(fd, buf);
      written += buf.length;
    }
    return written;
  } catch (err) {
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
    safeUnlink(path);
    throw err;
  } finally {
    try {
      closeSync(fd);
    } catch {
      /* ignore */
    }
  }
}

export function readHoldingAssetNoFollow(
  layout: R1DataLayout,
  holdingDir: string,
  sha256: string,
  byteLength: number,
): Uint8Array {
  assertSha256Hex(sha256);
  const ctx = refreshR1DataLayout(layout);
  validateSubdirectory(ctx.rootReal, holdingDir);
  const path = join(holdingDir, sha256);
  assertPathContained(ctx.rootReal, path);
  return new Uint8Array(
    readFileNoFollow(ctx.rootReal, path, byteLength),
  );
}

export function safeUnlink(path: string): void {
  try {
    if (existsSync(path)) {
      lstatSafe(path);
      unlinkSync(path);
    }
  } catch {
    /* ignore */
  }
}

export function cleanupImportSessionPaths(
  layout: R1DataLayout,
  importSessionId: string,
): void {
  try {
    const ctx = refreshR1DataLayout(layout);
    safeUnlink(sessionSpoolPath(ctx, importSessionId));
    const holdingDir = sessionHoldingDir(ctx, importSessionId);
    const workerTempDir = sessionWorkerTempDir(ctx, importSessionId);
    for (const dir of [holdingDir, workerTempDir]) {
      try {
        if (existsSync(dir)) {
          validateSubdirectory(ctx.rootReal, dir);
          rmSync(dir, { recursive: true, force: true });
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* best-effort cleanup when layout paths were tampered with mid-import */
  }
}

function sumRegularFiles(rootReal: string, dir: string): number {
  let total = 0;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const name of entries) {
    const path = join(dir, name);
    let st;
    try {
      st = lstatSync(path);
      assertNotSymlinkForMeasure(st, path);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      total += sumRegularFiles(rootReal, path);
      continue;
    }
    if (st.isFile()) {
      resolveContainedPath(rootReal, path);
      total += Number(st.size);
    }
  }
  return total;
}

function assertNotSymlinkForMeasure(
  st: { isSymbolicLink(): boolean },
  path: string,
): void {
  if (st.isSymbolicLink()) {
    throw new PathSafetyError(`SYMLINK_NOT_ALLOWED:${path}`);
  }
}

/** Post-materialization file bytes under R1_DATA_DIR (Design §4.6.2). */
export function measureDataDirFileBytes(layout: R1DataLayout): number {
  const ctx = refreshR1DataLayout(layout);
  const total =
    sumRegularFiles(ctx.rootReal, ctx.assets) +
    sumRegularFiles(ctx.rootReal, ctx.importSpool) +
    sumRegularFiles(ctx.rootReal, ctx.importHolding) +
    sumRegularFiles(ctx.rootReal, ctx.workerTemp);
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RangeError("measureDataDirFileBytes: non-finite total");
  }
  return total;
}
