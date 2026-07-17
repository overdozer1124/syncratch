/**
 * Document ↔ Scratch VM project.json bridge using production sb3-tools converters.
 */

import type { ProjectDocument } from "@blocksync/project-schema";
import {
  documentToProjectJson,
  projectJsonToDocument,
} from "@blocksync/sb3-tools";
import type { AdapterHandle } from "@blocksync/scratch-adapter";

export interface AssetIndexEntry {
  contentSha256: string;
  dataFormat: string;
}

export function buildAssetMaps(document: ProjectDocument): {
  assetIndex: Map<string, AssetIndexEntry>;
  md5extToSha: Map<string, string>;
} {
  const assetIndex = new Map<string, AssetIndexEntry>();
  const md5extToSha = new Map<string, string>();
  for (const target of document.targets) {
    for (const costume of target.costumes ?? []) {
      assetIndex.set(costume.assetId, {
        contentSha256: costume.contentSha256,
        dataFormat: costume.dataFormat,
      });
      md5extToSha.set(costume.md5ext, costume.contentSha256);
    }
    for (const sound of target.sounds ?? []) {
      assetIndex.set(sound.assetId, {
        contentSha256: sound.contentSha256,
        dataFormat: sound.dataFormat,
      });
      md5extToSha.set(sound.md5ext, sound.contentSha256);
    }
  }
  return { assetIndex, md5extToSha };
}

export async function loadDocumentIntoVm(
  handle: AdapterHandle,
  document: ProjectDocument,
): Promise<void> {
  // Pass a plain object — stringifying can make vendor loadProject fall through
  // to the SB1 decoder on some Node/webpack paths.
  await handle.vm.loadProject(documentToProjectJson(document));
}

/**
 * Convert VM runtime JSON to ProjectDocument.
 * Preserves loaded `meta` so block-only edits stay equivalence-stable.
 */
export function vmToDocument(
  handle: AdapterHandle,
  md5extToSha: Map<string, string>,
  metaOverride: ProjectDocument["meta"],
): ProjectDocument {
  const raw = JSON.parse(handle.vm.toJSON()) as unknown;
  const document = projectJsonToDocument(raw, md5extToSha);
  if (metaOverride !== undefined) {
    return { ...document, meta: structuredClone(metaOverride) };
  }
  return document;
}
