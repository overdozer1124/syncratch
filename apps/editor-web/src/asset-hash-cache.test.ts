import {describe, expect, it, vi} from "vitest";
import {createAssetHashCache} from "./asset-hash-cache.js";

describe("createAssetHashCache", () => {
  it("hashes each content-addressed asset only once", () => {
    const hash = vi.fn((bytes: Uint8Array) => `hash-${bytes[0]}`);
    const cache = createAssetHashCache(hash);
    const first = new Map([
      ["a.svg", new Uint8Array([1])],
      ["b.svg", new Uint8Array([2])],
    ]);

    expect(cache.hashesFor(first)).toEqual(new Map([
      ["a.svg", "hash-1"],
      ["b.svg", "hash-2"],
    ]));
    expect(cache.hashesFor(new Map([
      ["a.svg", new Uint8Array([9])],
      ["b.svg", new Uint8Array([8])],
    ]))).toEqual(new Map([
      ["a.svg", "hash-1"],
      ["b.svg", "hash-2"],
    ]));
    expect(hash).toHaveBeenCalledTimes(2);
  });
});
