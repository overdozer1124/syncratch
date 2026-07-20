import {
  LOCAL_PROJECT_FORMAT,
  type LocalProjectRecord,
} from "@blocksync/project-local-core";
import type {ProjectDocument} from "@blocksync/project-schema";

export class MissingAssetError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(
      missing.length === 1
        ? `Missing asset ${missing[0]}`
        : `Missing assets ${missing.join(", ")}`,
    );
    this.name = "MissingAssetError";
    this.missing = missing;
  }
}

export function requiredAssetMd5exts(document: ProjectDocument): string[] {
  const required = new Set<string>();
  for (const target of document.targets) {
    for (const costume of target.costumes ?? []) required.add(costume.md5ext);
    for (const sound of target.sounds ?? []) required.add(sound.md5ext);
  }
  return [...required];
}

export function findMissingAssets(
  document: ProjectDocument,
  assets: ReadonlyMap<string, Uint8Array>,
): string[] {
  return requiredAssetMd5exts(document).filter(md5ext => !assets.has(md5ext));
}

export function assetRecordsFromMap(
  document: ProjectDocument,
  assets: ReadonlyMap<string, Uint8Array>,
): LocalProjectRecord["assets"] {
  const missing = findMissingAssets(document, assets);
  if (missing.length > 0) throw new MissingAssetError(missing);
  return requiredAssetMd5exts(document).map(md5ext => ({
    md5ext,
    bytes: assets.get(md5ext)!,
  }));
}

export function isMissingAssetError(error: unknown): boolean {
  if (error instanceof MissingAssetError) return true;
  return error instanceof Error && error.message.startsWith("Missing asset");
}

export interface CreateRecoveryCopyOptions {
  current: LocalProjectRecord;
  title: string;
  document: ProjectDocument;
  assets: ReadonlyMap<string, Uint8Array>;
  localProjectId: string;
  now?: () => string;
}

export function createRecoveryCopy(
  options: CreateRecoveryCopyOptions,
): LocalProjectRecord {
  const {current, title, document, assets, localProjectId} = options;
  const driveFileId =
    typeof current.driveFileId === "string" && current.driveFileId.length > 0
      ? current.driveFileId
      : undefined;
  return {
    format: LOCAL_PROJECT_FORMAT,
    localProjectId,
    title,
    revision: 0,
    updatedAt: (options.now ?? (() => new Date().toISOString()))(),
    document,
    assets: assetRecordsFromMap(document, assets),
    saveState: "clean",
    ...(driveFileId ? {driveFileId} : {}),
  };
}

export function recordHasMissingStoredAssets(
  record: LocalProjectRecord,
): boolean {
  const stored = new Map(
    record.assets.map(asset => [asset.md5ext, asset.bytes] as const),
  );
  return findMissingAssets(record.document, stored).length > 0;
}
