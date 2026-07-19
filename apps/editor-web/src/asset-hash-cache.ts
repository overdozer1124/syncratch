export interface AssetHashCache {
  hashesFor(assets: Map<string, Uint8Array>): Map<string, string>;
}

/**
 * Asset keys are content addresses, so the digest for a key is immutable.
 * Reuse it instead of hashing every asset for every VM change event.
 */
export function createAssetHashCache(
  hash: (bytes: Uint8Array) => string,
): AssetHashCache {
  const cache = new Map<string, string>();
  return {
    hashesFor(assets) {
      const result = new Map<string, string>();
      for (const [md5ext, bytes] of assets) {
        let digest = cache.get(md5ext);
        if (!digest) {
          digest = hash(bytes);
          cache.set(md5ext, digest);
        }
        result.set(md5ext, digest);
      }
      return result;
    },
  };
}
