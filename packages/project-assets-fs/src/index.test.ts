import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, afterEach } from "vitest";
import {
  AssetBytesHashMismatchError,
  AssetFinalHashMismatchError,
  AssetTmpHashMismatchError,
  InvalidSha256Error,
  PathSafetyError,
  assertSha256Hex,
  contentSha256,
  createAssetFsStore,
  readRawLiveAsset,
  validateAssetsRoot,
  writeRawLiveAsset,
} from "./index.js";
import { __setWriteSyncForTests } from "./write-bytes.js";
import { writeSync as nodeWriteSync } from "node:fs";

function tempAssetsRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function sampleBytes(label = "payload"): { bytes: Uint8Array; sha256: string } {
  const bytes = new TextEncoder().encode(label);
  return { bytes, sha256: contentSha256(bytes) };
}

function replaceDirWithJunction(dirPath: string, target: string): void {
  rmSync(dirPath, { recursive: true, force: true });
  symlinkSync(target, dirPath, "junction");
}

function replaceDirWithDirectorySymlink(dirPath: string, target: string): void {
  rmSync(dirPath, { recursive: true, force: true });
  symlinkSync(target, dirPath, "dir");
}

const concurrentPutChildPath = fileURLToPath(
  new URL("./concurrent-put-child.ts", import.meta.url),
);

function runConcurrentPuts(
  root: string,
  sha256: string,
  bytes: Uint8Array,
  count: number,
): Promise<Array<{ wrote: boolean }>> {
  return Promise.all(
    Array.from({ length: count }, () =>
      new Promise<{ wrote: boolean }>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            concurrentPutChildPath,
            root,
            sha256,
            JSON.stringify([...bytes]),
          ],
          { stdio: ["ignore", "pipe", "pipe"] },
        );
        let stdout = "";
        let stderr = "";
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
        });
        child.stderr.on("data", (chunk: string) => {
          stderr += chunk;
        });
        child.on("error", reject);
        child.on("close", (code, signal) => {
          if (code !== 0) {
            reject(
              new Error(
                `concurrent put child failed: code=${code} signal=${signal} stderr=${stderr}`,
              ),
            );
            return;
          }
          resolve(JSON.parse(stdout) as { wrote: boolean });
        });
      }),
    ),
  );
}

describe("assertSha256Hex", () => {
  it("accepts lowercase hex", () => {
    expect(() => assertSha256Hex("a".repeat(64))).not.toThrow();
  });

  it("rejects uppercase and traversal", () => {
    expect(() => assertSha256Hex("A".repeat(64))).toThrow(InvalidSha256Error);
    expect(() => assertSha256Hex("../" + "a".repeat(61))).toThrow(
      InvalidSha256Error,
    );
  });
});

describe("createAssetFsStore", () => {
  it("putIfAbsent writes atomically and is idempotent", () => {
    const root = tempAssetsRoot("assets-put-");
    const store = createAssetFsStore(root);
    const { bytes, sha256 } = sampleBytes("asset-one");

    const first = store.putIfAbsent(sha256, bytes);
    expect(first.wrote).toBe(true);
    expect(readdirSync(root).filter((n) => n.endsWith(".tmp"))).toHaveLength(0);

    const second = store.putIfAbsent(sha256, bytes);
    expect(second.wrote).toBe(false);
    expect(store.getLive(sha256)).toEqual(bytes);
  });

  it("rejects bytes that do not match sha256", () => {
    const store = createAssetFsStore(tempAssetsRoot("assets-hash-"));
    expect(() =>
      store.putIfAbsent("b".repeat(64), new TextEncoder().encode("wrong")),
    ).toThrow(AssetBytesHashMismatchError);
  });

  it("rejects existing live file with wrong bytes", () => {
    const root = tempAssetsRoot("assets-final-");
    const store = createAssetFsStore(root);
    const { sha256 } = sampleBytes("good");
    writeRawLiveAsset(root, sha256, new TextEncoder().encode("bad-bytes"));
    expect(() =>
      store.putIfAbsent(sha256, new TextEncoder().encode("good")),
    ).toThrow(AssetFinalHashMismatchError);
  });

  it("moveLiveToQuarantine renames without leaving live copy", () => {
    const store = createAssetFsStore(tempAssetsRoot("assets-q-"));
    const { bytes, sha256 } = sampleBytes("quarantine-me");
    store.putIfAbsent(sha256, bytes);

    const result = store.moveLiveToQuarantine(sha256);
    expect(result).toEqual({
      moved: true,
      liveHadFile: true,
      quarantineHadFile: false,
    });
    expect(store.liveExists(sha256)).toBe(false);
    expect(store.getQuarantined(sha256)).toEqual(bytes);
  });

  it("deleteQuarantined removes quarantine bytes only", () => {
    const store = createAssetFsStore(tempAssetsRoot("assets-del-q-"));
    const { bytes, sha256 } = sampleBytes("delete-quarantine");
    store.putIfAbsent(sha256, bytes);
    store.moveLiveToQuarantine(sha256);
    expect(store.deleteQuarantined(sha256)).toBe(true);
    expect(store.quarantineExists(sha256)).toBe(false);
  });

  it("moveLiveToQuarantine is no-op when live file missing", () => {
    const store = createAssetFsStore(tempAssetsRoot("assets-no-live-"));
    const sha256 = "c".repeat(64);
    expect(store.moveLiveToQuarantine(sha256)).toEqual({
      moved: false,
      liveHadFile: false,
      quarantineHadFile: false,
    });
  });

  it("rejects symlinked assetsRoot at startup", () => {
    const realRoot = tempAssetsRoot("assets-real-");
    mkdirSync(realRoot, { recursive: true });
    const linkRoot = join(tmpdir(), `assets-link-${randomBytes(4).toString("hex")}`);
    try {
      symlinkSync(realRoot, linkRoot, "junction");
      expect(() => createAssetFsStore(linkRoot)).toThrow(PathSafetyError);
      expect(() => validateAssetsRoot(linkRoot)).toThrow(/SYMLINK_NOT_ALLOWED/);
    } finally {
      rmSync(linkRoot, { force: true });
    }
  });

  it("rejects reading live asset when path is a symlink", () => {
    const root = tempAssetsRoot("assets-sym-file-");
    const store = createAssetFsStore(root);
    const { bytes, sha256 } = sampleBytes("symlink-target");
    const other = sampleBytes("symlink-other");
    store.putIfAbsent(sha256, bytes);
    store.putIfAbsent(other.sha256, other.bytes);

    const liveFile = join(root, sha256);
    unlinkSync(liveFile);

    try {
      symlinkSync(join(root, other.sha256), liveFile, "file");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "ENOTSUP") {
        // Windows without symlink privilege — assetsRoot junction test covers §4.5.2
        return;
      }
      throw err;
    }
    try {
      expect(() => store.getLive(sha256)).toThrow(PathSafetyError);
      expect(() => store.liveExists(sha256)).toThrow(PathSafetyError);
    } finally {
      if (existsSync(liveFile)) rmSync(liveFile, { force: true });
    }
  });

  it("rejects moveLiveToQuarantine when quarantine target already exists", () => {
    const store = createAssetFsStore(tempAssetsRoot("assets-q-dup-"));
    const { bytes, sha256 } = sampleBytes("dup-quarantine");
    store.putIfAbsent(sha256, bytes);
    store.moveLiveToQuarantine(sha256);
    writeRawLiveAsset(store.assetsRoot, sha256, bytes);
    expect(() => store.moveLiveToQuarantine(sha256)).toThrow(
      /QUARANTINE_TARGET_EXISTS/,
    );
  });

  it("contentSha256 matches createHash", () => {
    const bytes = randomBytes(32);
    expect(contentSha256(bytes)).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
  });

  it("rejects putIfAbsent after assetsRoot replaced with junction (no outside tmp)", () => {
    const realRoot = tempAssetsRoot("assets-hijack-root-");
    const outside = tempAssetsRoot("assets-outside-root-");
    const store = createAssetFsStore(realRoot);
    const { bytes, sha256 } = sampleBytes("root-hijack");

    replaceDirWithJunction(realRoot, outside);

    expect(() => store.putIfAbsent(sha256, bytes)).toThrow(PathSafetyError);
    expect(readdirSync(outside).filter((n) => n.endsWith(".tmp"))).toHaveLength(
      0,
    );
  });

  it("rejects putIfAbsent after assetsRoot replaced with directory symlink when supported", () => {
    const realRoot = tempAssetsRoot("assets-hijack-root-dir-");
    const outside = tempAssetsRoot("assets-outside-root-dir-");
    const store = createAssetFsStore(realRoot);
    const { bytes, sha256 } = sampleBytes("root-hijack-dir");

    try {
      replaceDirWithDirectorySymlink(realRoot, outside);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "ENOTSUP") {
        return;
      }
      throw err;
    }

    expect(() => store.putIfAbsent(sha256, bytes)).toThrow(PathSafetyError);
    expect(readdirSync(outside).filter((n) => n.endsWith(".tmp"))).toHaveLength(
      0,
    );
  });

  it("rejects moveLiveToQuarantine after .quarantine replaced with junction", () => {
    const root = tempAssetsRoot("assets-hijack-q-");
    const outside = tempAssetsRoot("assets-outside-q-");
    const store = createAssetFsStore(root);
    const { bytes, sha256 } = sampleBytes("quarantine-hijack");
    store.putIfAbsent(sha256, bytes);

    replaceDirWithJunction(join(root, ".quarantine"), outside);

    expect(() => store.moveLiveToQuarantine(sha256)).toThrow(PathSafetyError);
    expect(existsSync(join(outside, sha256))).toBe(false);
    expect(readRawLiveAsset(root, sha256)).toEqual(bytes);
  });

  it("rejects moveLiveToQuarantine after .quarantine replaced with directory symlink when supported", () => {
    const root = tempAssetsRoot("assets-hijack-q-dir-");
    const outside = tempAssetsRoot("assets-outside-q-dir-");
    const store = createAssetFsStore(root);
    const { bytes, sha256 } = sampleBytes("quarantine-hijack-dir");
    store.putIfAbsent(sha256, bytes);

    try {
      replaceDirWithDirectorySymlink(join(root, ".quarantine"), outside);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "ENOTSUP") {
        return;
      }
      throw err;
    }

    expect(() => store.moveLiveToQuarantine(sha256)).toThrow(PathSafetyError);
    expect(existsSync(join(outside, sha256))).toBe(false);
    expect(readRawLiveAsset(root, sha256)).toEqual(bytes);
  });

  it("rejects get/delete after .quarantine replaced with junction", () => {
    const root = tempAssetsRoot("assets-hijack-qops-");
    const outside = tempAssetsRoot("assets-outside-qops-");
    const store = createAssetFsStore(root);
    const { bytes, sha256 } = sampleBytes("quarantine-ops");
    store.putIfAbsent(sha256, bytes);
    store.moveLiveToQuarantine(sha256);

    replaceDirWithJunction(join(root, ".quarantine"), outside);

    expect(() => store.getQuarantined(sha256)).toThrow(PathSafetyError);
    expect(() => store.deleteQuarantined(sha256)).toThrow(PathSafetyError);
  });

  it("concurrent putIfAbsent yields exactly one writer and no tmp files", async () => {
    const root = tempAssetsRoot("assets-race-");
    createAssetFsStore(root);
    const { bytes, sha256 } = sampleBytes("concurrent-race");

    const results = await runConcurrentPuts(root, sha256, bytes, 8);
    expect(results.filter((r) => r.wrote)).toHaveLength(1);
    expect(results.filter((r) => !r.wrote)).toHaveLength(7);
    expect(readdirSync(root).filter((n) => n.endsWith(".tmp"))).toHaveLength(
      0,
    );
    expect(existsSync(join(root, sha256))).toBe(true);
  });
});

describe("putIfAbsent short-write fault injection", () => {
  afterEach(() => {
    __setWriteSyncForTests(null);
  });

  it("publishes when writeSync returns partial progress repeatedly", () => {
    const root = tempAssetsRoot("assets-partial-ok-");
    const store = createAssetFsStore(root);
    const bytes = randomBytes(16);
    const sha256 = contentSha256(bytes);

    __setWriteSyncForTests((fd, buf, offset, length) => {
      const chunk = Math.min(4, length);
      return nodeWriteSync(fd, buf, offset, chunk);
    });

    const result = store.putIfAbsent(sha256, bytes);
    expect(result.wrote).toBe(true);
    expect(store.getLive(sha256)).toEqual(new Uint8Array(bytes));
    expect(readdirSync(root).filter((n) => n.endsWith(".tmp"))).toHaveLength(0);
  });

  it("rejects zero-byte write progress without creating final", () => {
    const root = tempAssetsRoot("assets-zero-write-");
    const store = createAssetFsStore(root);
    const { bytes, sha256 } = sampleBytes("zero-write-fail");

    __setWriteSyncForTests(() => 0);

    expect(() => store.putIfAbsent(sha256, bytes)).toThrow(/SHORT_WRITE/);
    expect(existsSync(join(root, sha256))).toBe(false);
    expect(readdirSync(root).filter((n) => n.endsWith(".tmp"))).toHaveLength(0);
  });

  it("rejects stalled partial write without creating final", () => {
    const root = tempAssetsRoot("assets-stall-write-");
    const store = createAssetFsStore(root);
    const bytes = randomBytes(16);
    const sha256 = contentSha256(bytes);
    let calls = 0;

    __setWriteSyncForTests((fd, buf, offset, length) => {
      calls += 1;
      if (calls === 1) {
        return nodeWriteSync(fd, buf, offset, 8);
      }
      return 0;
    });

    expect(() => store.putIfAbsent(sha256, bytes)).toThrow(/SHORT_WRITE/);
    expect(existsSync(join(root, sha256))).toBe(false);
    expect(readdirSync(root).filter((n) => n.endsWith(".tmp"))).toHaveLength(0);
  });

  it("rejects mid-write exception and cleans up tmp", () => {
    const root = tempAssetsRoot("assets-write-exc-");
    const store = createAssetFsStore(root);
    const { bytes, sha256 } = sampleBytes("write-exception");
    let calls = 0;

    __setWriteSyncForTests((fd, buf, offset, length) => {
      calls += 1;
      if (calls === 1) {
        return nodeWriteSync(fd, buf, offset, Math.min(4, length));
      }
      throw new Error("SIMULATED_WRITE_FAULT");
    });

    expect(() => store.putIfAbsent(sha256, bytes)).toThrow(/SIMULATED_WRITE_FAULT/);
    expect(existsSync(join(root, sha256))).toBe(false);
    expect(readdirSync(root).filter((n) => n.endsWith(".tmp"))).toHaveLength(0);
  });

  it("rejects tmp hash mismatch before publish without creating final", () => {
    const root = tempAssetsRoot("assets-tmp-hash-");
    const store = createAssetFsStore(root);
    const bytes = randomBytes(16);
    const sha256 = contentSha256(bytes);

    __setWriteSyncForTests((fd, _buf, _offset, length) => {
      return nodeWriteSync(fd, Buffer.alloc(length, 0), 0, length);
    });

    expect(() => store.putIfAbsent(sha256, bytes)).toThrow(
      AssetTmpHashMismatchError,
    );
    expect(existsSync(join(root, sha256))).toBe(false);
    expect(readdirSync(root).filter((n) => n.endsWith(".tmp"))).toHaveLength(0);
  });
});
