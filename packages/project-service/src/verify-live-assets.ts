import { createHash } from "node:crypto";
import type {
  CostumeRef,
  ProjectDocument,
  SoundRef,
} from "@blocksync/project-schema";
import {
  AssetIntegrityError,
  AssetRefMismatchError,
} from "./errors.js";
import type {
  CommitAssetExpectation,
  CommitAssetGuard,
  LiveAssetByteStore,
} from "./ports.js";
import {
  verifyMp3RefAgainstBytes,
  verifyWavRefAgainstBytes,
} from "./verify-audio-bytes.js";

const SHA256_HEX = /^[0-9a-f]{64}$/;

export function canonicalDataFormat(format: string): string {
  return format === "jpeg" ? "jpg" : format;
}

export function collectDocumentAssetShas(document: ProjectDocument): Set<string> {
  const shas = new Set<string>();
  for (const target of document.targets) {
    for (const costume of target.costumes ?? []) {
      shas.add(costume.contentSha256);
    }
    for (const sound of target.sounds ?? []) {
      shas.add(sound.contentSha256);
    }
  }
  return shas;
}

function assertSha256Hex(sha256: string): void {
  if (!SHA256_HEX.test(sha256)) {
    throw new AssetRefMismatchError(`INVALID_SHA256:${sha256}`);
  }
}

function verifyMd5ext(ref: {
  assetId: string;
  md5ext: string;
  dataFormat: string;
}): void {
  const canonical = canonicalDataFormat(ref.dataFormat);
  const expected = `${ref.assetId}.${canonical}`;
  if (ref.md5ext !== expected) {
    throw new AssetRefMismatchError("MD5EXT");
  }
  if (ref.assetId !== ref.md5ext.replace(/\.[^.]+$/, "")) {
    throw new AssetRefMismatchError("ASSET_ID");
  }
}

function verifySoundRefMetadata(ref: SoundRef): void {
  if (!Number.isFinite(ref.rate) || ref.rate <= 0) {
    throw new AssetRefMismatchError("SOUND_RATE");
  }
  if (!Number.isFinite(ref.sampleCount) || ref.sampleCount <= 0) {
    throw new AssetRefMismatchError("SOUND_SAMPLE_COUNT");
  }
}

/** Heavy ref + byte checks safe outside the commit transaction. */
export function verifyAssetRefPreflight(
  ref: CostumeRef | SoundRef,
  bytes: Uint8Array,
): void {
  assertSha256Hex(ref.contentSha256);
  verifyMd5ext(ref);

  if (ref.assetId.toLowerCase() !== ref.assetId) {
    throw new AssetRefMismatchError("ASSET_ID_CASE");
  }

  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== ref.contentSha256) {
    throw new AssetIntegrityError(ref.contentSha256, "DIGEST");
  }

  if (ref.kind === "sound") {
    verifySoundRefMetadata(ref);
    const format = canonicalDataFormat(ref.dataFormat);
    if (format === "wav") {
      verifyWavRefAgainstBytes(bytes, ref.rate, ref.sampleCount);
    } else if (format === "mp3") {
      verifyMp3RefAgainstBytes(bytes, ref.rate, ref.sampleCount);
    }
  }
}

function verifyRefBytesPreflight(
  ref: CostumeRef | SoundRef,
  byteStore: LiveAssetByteStore,
): void {
  const bytes = byteStore.readLiveBytes(ref.contentSha256);
  if (!bytes) {
    throw new AssetIntegrityError(ref.contentSha256, "MISSING_BYTES");
  }
  verifyAssetRefPreflight(ref, bytes);
}

/** Preflight byte/metadata verification (Design §4.2 items 3–8 except live/grant). */
export function verifyDocumentAssetPreflight(
  document: ProjectDocument,
  byteStore: LiveAssetByteStore,
): void {
  for (const target of document.targets) {
    for (const costume of target.costumes ?? []) {
      verifyRefBytesPreflight(costume, byteStore);
    }
    for (const sound of target.sounds ?? []) {
      verifyRefBytesPreflight(sound, byteStore);
    }
  }
}

/** Build commit-time metadata expectations from refs and preflight byte reads. */
export function collectCommitAssetExpectations(
  document: ProjectDocument,
  byteStore: LiveAssetByteStore,
): CommitAssetExpectation[] {
  const expectations: CommitAssetExpectation[] = [];
  const bySha = new Map<string, CommitAssetExpectation>();

  function addRef(ref: CostumeRef | SoundRef): void {
    const bytes = byteStore.readLiveBytes(ref.contentSha256);
    if (!bytes) {
      throw new AssetIntegrityError(ref.contentSha256, "MISSING_BYTES");
    }
    const expectation: CommitAssetExpectation = {
      sha256: ref.contentSha256,
      md5Hex: ref.assetId,
      dataFormat: canonicalDataFormat(ref.dataFormat),
      byteLength: bytes.length,
    };
    const existing = bySha.get(ref.contentSha256);
    if (existing) {
      if (
        existing.md5Hex !== expectation.md5Hex ||
        existing.dataFormat !== expectation.dataFormat ||
        existing.byteLength !== expectation.byteLength
      ) {
        throw new AssetRefMismatchError(
          `DUPLICATE_SHA_METADATA:${ref.contentSha256}`,
        );
      }
      return;
    }
    bySha.set(ref.contentSha256, expectation);
    expectations.push(expectation);
  }

  for (const target of document.targets) {
    for (const costume of target.costumes ?? []) {
      addRef(costume);
    }
    for (const sound of target.sounds ?? []) {
      addRef(sound);
    }
  }

  return expectations;
}

/** Commit-time live/grant + DB metadata re-check inside the revision write transaction. */
export function assertDocumentLiveGrantsInCommit(
  organizationId: string,
  document: ProjectDocument,
  guard: CommitAssetGuard,
  byteStore: LiveAssetByteStore,
): void {
  const expectations = collectCommitAssetExpectations(document, byteStore);
  if (expectations.length === 0) {
    return;
  }
  guard.assertLiveGrantsInCommit(organizationId, expectations);
}

export function assertLiveGrantsForExpectations(
  organizationId: string,
  expectations: CommitAssetExpectation[],
  guard: CommitAssetGuard,
): void {
  if (expectations.length === 0) {
    return;
  }
  guard.assertLiveGrantsInCommit(organizationId, expectations);
}
