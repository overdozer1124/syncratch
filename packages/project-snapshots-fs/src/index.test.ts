import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createFsSnapshotStore } from "./index.js";

describe("createFsSnapshotStore", () => {
  it("writes atomically and reuses existing final by hash", () => {
    const dir = mkdtempSync(join(tmpdir(), "snap-"));
    const store = createFsSnapshotStore(dir);
    const bytes = new TextEncoder().encode(JSON.stringify({ a: 1 }));
    const contentHash = createHash("sha256").update(bytes).digest("hex");

    const first = store.putAtomic(contentHash, bytes);
    expect(first.storageKey).toBe(`${contentHash}.json`);
    expect(readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toHaveLength(0);

    const second = store.putAtomic(contentHash, bytes);
    expect(second.storageKey).toBe(first.storageKey);
    expect(JSON.parse(readFileSync(join(dir, first.storageKey), "utf8"))).toEqual({
      a: 1,
    });
  });

  it("rejects bytes that do not match contentHash", () => {
    const dir = mkdtempSync(join(tmpdir(), "snap-bad-"));
    const store = createFsSnapshotStore(dir);
    expect(() =>
      store.putAtomic("0".repeat(64), new TextEncoder().encode("{}")),
    ).toThrow(/SNAPSHOT_BYTES_HASH_MISMATCH/);
  });

  it("gcOrphans removes unreferenced files and temps", () => {
    const dir = mkdtempSync(join(tmpdir(), "snap-"));
    const store = createFsSnapshotStore(dir);
    const bytes = new TextEncoder().encode("{}");
    const contentHash = createHash("sha256").update(bytes).digest("hex");
    store.putAtomic(contentHash, bytes);
    const removed = store.gcOrphans([]);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(readdirSync(dir)).toHaveLength(0);
  });
});
