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
import { describe, expect, it } from "vitest";
import {
  AssetBytesHashMismatchError,
  AssetFinalHashMismatchError,
  InvalidSha256Error,
  PathSafetyError,
  assertSha256Hex,
  contentSha256,
  createAssetFsStore,
  validateAssetsRoot,
  writeRawLiveAsset,
} from "./index.js";

function tempAssetsRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function sampleBytes(label = "payload"): { bytes: Uint8Array; sha256: string } {
  const bytes = new TextEncoder().encode(label);
  return { bytes, sha256: contentSha256(bytes) };
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
});
