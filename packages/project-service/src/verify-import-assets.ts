import { createHash } from "node:crypto";
import type {
  CostumeRef,
  ProjectDocument,
  SoundRef,
} from "@blocksync/project-schema";
import { ImportPreconditionError } from "./errors.js";
import type { ImportAssetObjectInput, LiveAssetByteStore } from "./ports.js";
import {
  canonicalDataFormat,
  collectDocumentAssetShas,
} from "./verify-live-assets.js";
import {
  verifyMp3RefAgainstBytes,
  verifyWavRefAgainstBytes,
} from "./verify-audio-bytes.js";
import { verifyAssetRefPreflight } from "./verify-live-assets.js";

function objectMap(
  assetObjects: ImportAssetObjectInput[],
): Map<string, ImportAssetObjectInput> {
  const map = new Map<string, ImportAssetObjectInput>();
  for (const object of assetObjects) {
    if (map.has(object.sha256)) {
      throw new ImportPreconditionError(`DUPLICATE_ASSET_OBJECT:${object.sha256}`);
    }
    map.set(object.sha256, object);
  }
  return map;
}

function verifyImportRef(
  ref: CostumeRef | SoundRef,
  object: ImportAssetObjectInput,
  byteStore: LiveAssetByteStore,
): void {
  const canonical = canonicalDataFormat(ref.dataFormat);
  const bytes = byteStore.readLiveBytes(ref.contentSha256);
  if (!bytes) {
    throw new ImportPreconditionError(`ASSET_BYTES_MISSING:${ref.contentSha256}`);
  }

  const actualMd5Hex = createHash("md5").update(bytes).digest("hex");
  if (actualMd5Hex !== ref.assetId.toLowerCase()) {
    throw new ImportPreconditionError(`ASSET_MD5_BYTES_MISMATCH:${ref.contentSha256}`);
  }
  if (object.md5Hex.toLowerCase() !== actualMd5Hex) {
    throw new ImportPreconditionError(`ASSET_MD5_OBJECT_MISMATCH:${ref.contentSha256}`);
  }
  if (object.md5Hex.toLowerCase() !== ref.assetId.toLowerCase()) {
    throw new ImportPreconditionError(`ASSET_MD5_MISMATCH:${ref.contentSha256}`);
  }
  if (canonicalDataFormat(object.dataFormat) !== canonical) {
    throw new ImportPreconditionError(`ASSET_FORMAT_MISMATCH:${ref.contentSha256}`);
  }
  if (object.byteLength !== bytes.length) {
    throw new ImportPreconditionError(`ASSET_BYTE_LENGTH_MISMATCH:${ref.contentSha256}`);
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== ref.contentSha256) {
    throw new ImportPreconditionError(`ASSET_DIGEST_MISMATCH:${ref.contentSha256}`);
  }

  verifyAssetRefPreflight(ref, bytes);

  if (ref.kind === "sound") {
    const format = canonicalDataFormat(ref.dataFormat);
    if (format === "wav") {
      verifyWavRefAgainstBytes(bytes, ref.rate, ref.sampleCount);
    } else if (format === "mp3") {
      verifyMp3RefAgainstBytes(bytes, ref.rate, ref.sampleCount);
    }
  }
}

/** Full ref ↔ object ↔ CAS byte alignment before atomic import (Design §4.2). */
export function verifyImportAssetBundle(
  document: ProjectDocument,
  assetObjects: ImportAssetObjectInput[],
  byteStore: LiveAssetByteStore,
): ImportAssetObjectInput[] {
  const requiredShas = collectDocumentAssetShas(document);
  const objects = objectMap(assetObjects);
  if (objects.size !== requiredShas.size) {
    throw new ImportPreconditionError("ASSET_OBJECT_SET_MISMATCH");
  }
  for (const sha of requiredShas) {
    if (!objects.has(sha)) {
      throw new ImportPreconditionError(`MISSING_ASSET_OBJECT:${sha}`);
    }
  }
  for (const extra of objects.keys()) {
    if (!requiredShas.has(extra)) {
      throw new ImportPreconditionError(`EXTRA_ASSET_OBJECT:${extra}`);
    }
  }

  for (const target of document.targets) {
    for (const costume of target.costumes ?? []) {
      verifyImportRef(costume, objects.get(costume.contentSha256)!, byteStore);
    }
    for (const sound of target.sounds ?? []) {
      verifyImportRef(sound, objects.get(sound.contentSha256)!, byteStore);
    }
  }

  return [...objects.values()];
}
