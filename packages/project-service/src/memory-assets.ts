import {
  AssetNotGrantedError,
  AssetNotLiveError,
  AssetRefMismatchError,
} from "./errors.js";
import type {
  ImportAssetObjectInput,
  ImportAtomicRepository,
  LiveAssetByteStore,
  LiveAssetCatalog,
  LiveAssetRecord,
} from "./ports.js";

export function createMemoryLiveAssetCatalog(): LiveAssetCatalog & {
  assets: Map<string, LiveAssetRecord>;
  grants: Set<string>;
  /** Test hook: next commit-time check fails as if GC quarantined the sha. */
  quarantineOnCommit: Set<string>;
  seedAsset(
    organizationId: string,
    asset: LiveAssetRecord,
  ): void;
} {
  const assets = new Map<string, LiveAssetRecord>();
  const grants = new Set<string>();
  const quarantineOnCommit = new Set<string>();

  return {
    assets,
    grants,
    quarantineOnCommit,
    seedAsset(organizationId, asset) {
      assets.set(asset.sha256, asset);
      grants.add(`${organizationId}:${asset.sha256}`);
    },
    getAsset(sha256) {
      return assets.get(sha256) ?? null;
    },
    hasOrgGrant(organizationId, sha256) {
      return grants.has(`${organizationId}:${sha256}`);
    },
    assertLiveGrantsInCommit(organizationId, expectations) {
      for (const expected of expectations) {
        if (quarantineOnCommit.has(expected.sha256)) {
          throw new AssetNotLiveError(expected.sha256);
        }
        const record = assets.get(expected.sha256);
        if (!record || record.gcState !== "live") {
          throw new AssetNotLiveError(expected.sha256);
        }
        if (record.md5Hex !== expected.md5Hex) {
          throw new AssetRefMismatchError(`DB_MD5:${expected.sha256}`);
        }
        if (record.dataFormat !== expected.dataFormat) {
          throw new AssetRefMismatchError(`DB_DATA_FORMAT:${expected.sha256}`);
        }
        if (record.byteLength !== expected.byteLength) {
          throw new AssetRefMismatchError(`DB_BYTE_LENGTH:${expected.sha256}`);
        }
        if (!grants.has(`${organizationId}:${expected.sha256}`)) {
          throw new AssetNotGrantedError(expected.sha256);
        }
      }
    },
  };
}

export function createMemoryLiveAssetByteStore(): LiveAssetByteStore & {
  files: Map<string, Uint8Array>;
} {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    readLiveBytes(sha256) {
      return files.get(sha256) ?? null;
    },
  };
}

export function createMemoryImportAtomicRepository(): ImportAtomicRepository & {
  calls: Array<Parameters<ImportAtomicRepository["importSb3CreateProjectAtomic"]>[0]>;
} {
  const calls: Array<
    Parameters<ImportAtomicRepository["importSb3CreateProjectAtomic"]>[0]
  > = [];
  return {
    calls,
    importSb3CreateProjectAtomic(input) {
      calls.push(input);
      return input.envelope;
    },
  };
}

export type { ImportAssetObjectInput };
