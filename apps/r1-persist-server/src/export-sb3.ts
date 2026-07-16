import {
  AssetIntegrityError,
  AssetNotGrantedError,
  AssetNotLiveError,
  AssetRefMismatchError,
  NotFoundError,
  type AuthHints,
  type LiveAssetCatalog,
  type ProjectService,
  collectCommitAssetExpectations,
  collectDocumentAssetShas,
  verifyDocumentAssetPreflight,
} from "@blocksync/project-service";
import type { AssetFsStore } from "@blocksync/project-assets-fs";
import { exportSb3 } from "@blocksync/sb3-tools";

export interface ExportSb3Deps {
  service: ProjectService;
  assetFs: AssetFsStore;
  liveCatalog: LiveAssetCatalog;
}

export async function exportSb3ForProject(
  deps: ExportSb3Deps,
  hints: AuthHints,
  projectId: string,
): Promise<Uint8Array> {
  const envelope = await deps.service.getProject(hints, projectId);
  const byteStore = {
    readLiveBytes(sha256: string) {
      return deps.assetFs.getLive(sha256);
    },
  };
  verifyDocumentAssetPreflight(envelope.document, byteStore);

  const expectations = collectCommitAssetExpectations(
    envelope.document,
    byteStore,
  );
  for (const expected of expectations) {
    const record = deps.liveCatalog.getAsset(expected.sha256);
    if (!record || record.gcState !== "live") {
      throw new AssetNotLiveError(expected.sha256);
    }
    if (!deps.liveCatalog.hasOrgGrant(envelope.organizationId, expected.sha256)) {
      throw new AssetNotGrantedError(expected.sha256);
    }
    if (
      record.md5Hex !== expected.md5Hex ||
      record.dataFormat !== expected.dataFormat ||
      record.byteLength !== expected.byteLength
    ) {
      throw new AssetRefMismatchError(`DB_METADATA:${expected.sha256}`);
    }
  }

  const assetBytes = new Map<string, Uint8Array>();
  for (const target of envelope.document.targets) {
    for (const costume of target.costumes ?? []) {
      const bytes = byteStore.readLiveBytes(costume.contentSha256);
      if (!bytes) {
        throw new AssetIntegrityError(costume.contentSha256, "MISSING_BYTES");
      }
      assetBytes.set(costume.md5ext, bytes);
    }
    for (const sound of target.sounds ?? []) {
      const bytes = byteStore.readLiveBytes(sound.contentSha256);
      if (!bytes) {
        throw new AssetIntegrityError(sound.contentSha256, "MISSING_BYTES");
      }
      assetBytes.set(sound.md5ext, bytes);
    }
  }

  if (envelope.document.schemaVersion < 2) {
    throw new NotFoundError("EXPORT_REQUIRES_SCHEMA_V2");
  }

  return exportSb3(envelope.document, assetBytes);
}

export function assertHeadReferencesSha(
  document: Parameters<typeof collectDocumentAssetShas>[0],
  sha256: string,
): void {
  if (!collectDocumentAssetShas(document).has(sha256)) {
    throw new NotFoundError("ASSET_NOT_IN_HEAD");
  }
}
