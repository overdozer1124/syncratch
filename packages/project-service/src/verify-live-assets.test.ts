import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { customProcedureFixtureDocument } from "@blocksync/project-envelope";
import type { ProjectDocument, SoundRef } from "@blocksync/project-schema";
import {
  AssetIntegrityError,
  AssetNotLiveError,
  AssetRefMismatchError,
  assertDocumentLiveGrantsInCommit,
  collectCommitAssetExpectations,
  verifyDocumentAssetPreflight,
} from "./index.js";
import {
  createMemoryLiveAssetByteStore,
  createMemoryLiveAssetCatalog,
} from "./memory-assets.js";
import { minimalWavBytes } from "./test-wav-fixtures.js";

const ORG = "org-demo";

function seedDocumentAssets(
  catalog: ReturnType<typeof createMemoryLiveAssetCatalog>,
  byteStore: ReturnType<typeof createMemoryLiveAssetByteStore>,
  organizationId: string,
  document: ProjectDocument,
): void {
  let index = 0;
  for (const target of document.targets) {
    for (const costume of target.costumes ?? []) {
      const bytes = new TextEncoder().encode(`asset-bytes-${index++}`);
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const md5Hex = createHash("md5").update(bytes).digest("hex");
      const canonical = costume.dataFormat === "jpeg" ? "jpg" : costume.dataFormat;
      costume.contentSha256 = sha256;
      costume.assetId = md5Hex;
      costume.md5ext = `${md5Hex}.${canonical}`;
      catalog.seedAsset(organizationId, {
        sha256,
        byteLength: bytes.length,
        md5Hex,
        dataFormat: canonical,
        gcState: "live",
      });
      byteStore.files.set(sha256, bytes);
    }
    for (const sound of target.sounds ?? []) {
      const bytes = minimalWavBytes({
        sampleCount: sound.sampleCount,
        rate: sound.rate,
      });
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const md5Hex = createHash("md5").update(bytes).digest("hex");
      sound.contentSha256 = sha256;
      sound.assetId = md5Hex;
      sound.md5ext = `${md5Hex}.wav`;
      catalog.seedAsset(organizationId, {
        sha256,
        byteLength: bytes.length,
        md5Hex,
        dataFormat: "wav",
        gcState: "live",
      });
      byteStore.files.set(sha256, bytes);
    }
  }
}

function soundDocument(
  byteStore: ReturnType<typeof createMemoryLiveAssetByteStore>,
): ProjectDocument {
  const bytes = minimalWavBytes({ sampleCount: 1032, rate: 44100 });
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const assetId = createHash("md5").update(bytes).digest("hex");
  byteStore.files.set(sha256, bytes);
  const doc = customProcedureFixtureDocument();
  let index = 0;
  for (const target of doc.targets) {
    for (const costume of target.costumes ?? []) {
      const costumeBytes = new TextEncoder().encode(`costume-${index++}`);
      const costumeSha = createHash("sha256").update(costumeBytes).digest("hex");
      costume.contentSha256 = costumeSha;
      byteStore.files.set(costumeSha, costumeBytes);
    }
  }
  const sound: SoundRef = {
    kind: "sound",
    name: "pop",
    assetId,
    md5ext: `${assetId}.wav`,
    dataFormat: "wav",
    contentSha256: sha256,
    rate: 44100,
    sampleCount: 1032,
    format: "",
  };
  doc.targets[0]!.sounds = [sound];
  return doc;
}

describe("verifyDocumentAssetPreflight", () => {
  it("accepts live granted assets with matching bytes", () => {
    const catalog = createMemoryLiveAssetCatalog();
    const byteStore = createMemoryLiveAssetByteStore();
    const doc = customProcedureFixtureDocument();
    seedDocumentAssets(catalog, byteStore, ORG, doc);

    expect(() => verifyDocumentAssetPreflight(doc, byteStore)).not.toThrow();
  });

  it("rejects fake WAV bytes for a sound ref", () => {
    const byteStore = createMemoryLiveAssetByteStore();
    const doc = soundDocument(byteStore);
    const fake = new TextEncoder().encode("definitely not a WAV file");
    const fakeSha = createHash("sha256").update(fake).digest("hex");
    doc.targets[0]!.sounds![0]!.contentSha256 = fakeSha;
    byteStore.files.set(fakeSha, fake);

    expect(() => verifyDocumentAssetPreflight(doc, byteStore)).toThrow(
      AssetRefMismatchError,
    );
  });

  it("rejects byte digest mismatch", () => {
    const catalog = createMemoryLiveAssetCatalog();
    const byteStore = createMemoryLiveAssetByteStore();
    const doc = customProcedureFixtureDocument();
    seedDocumentAssets(catalog, byteStore, ORG, doc);
    const sha = doc.targets[0]!.costumes![0]!.contentSha256;
    byteStore.files.set(sha, new TextEncoder().encode("other"));

    expect(() => verifyDocumentAssetPreflight(doc, byteStore)).toThrow(
      AssetIntegrityError,
    );
  });
});

describe("assertDocumentLiveGrantsInCommit", () => {
  it("rejects when GC quarantines between preflight and commit", () => {
    const catalog = createMemoryLiveAssetCatalog();
    const byteStore = createMemoryLiveAssetByteStore();
    const doc = customProcedureFixtureDocument();
    seedDocumentAssets(catalog, byteStore, ORG, doc);
    verifyDocumentAssetPreflight(doc, byteStore);
    const sha = doc.targets[0]!.costumes![0]!.contentSha256;
    catalog.quarantineOnCommit.add(sha);

    expect(() =>
      assertDocumentLiveGrantsInCommit(ORG, doc, catalog, byteStore),
    ).toThrow(AssetNotLiveError);
  });

  it("rejects when DB md5_hex mismatches ref at commit", () => {
    const catalog = createMemoryLiveAssetCatalog();
    const byteStore = createMemoryLiveAssetByteStore();
    const doc = customProcedureFixtureDocument();
    seedDocumentAssets(catalog, byteStore, ORG, doc);
    verifyDocumentAssetPreflight(doc, byteStore);
    const sha = doc.targets[0]!.costumes![0]!.contentSha256;
    const record = catalog.assets.get(sha)!;
    catalog.assets.set(sha, { ...record, md5Hex: "f".repeat(32) });

    expect(() =>
      assertDocumentLiveGrantsInCommit(ORG, doc, catalog, byteStore),
    ).toThrow(AssetRefMismatchError);
  });

  it("rejects when DB byte_length mismatches preflight bytes at commit", () => {
    const catalog = createMemoryLiveAssetCatalog();
    const byteStore = createMemoryLiveAssetByteStore();
    const doc = customProcedureFixtureDocument();
    seedDocumentAssets(catalog, byteStore, ORG, doc);
    verifyDocumentAssetPreflight(doc, byteStore);
    const sha = doc.targets[0]!.costumes![0]!.contentSha256;
    const record = catalog.assets.get(sha)!;
    catalog.assets.set(sha, { ...record, byteLength: record.byteLength + 1 });

    expect(() =>
      assertDocumentLiveGrantsInCommit(ORG, doc, catalog, byteStore),
    ).toThrow(AssetRefMismatchError);
  });

  it("rejects same SHA with conflicting assetId refs", () => {
    const catalog = createMemoryLiveAssetCatalog();
    const byteStore = createMemoryLiveAssetByteStore();
    const doc = customProcedureFixtureDocument();
    seedDocumentAssets(catalog, byteStore, ORG, doc);
    const costume0 = doc.targets[0]!.costumes![0]!;
    doc.targets[0]!.costumes!.push({
      ...costume0,
      name: "backdrop2",
      assetId: "b".repeat(32),
      md5ext: `${"b".repeat(32)}.svg`,
    });

    expect(() =>
      collectCommitAssetExpectations(doc, byteStore),
    ).toThrow(AssetRefMismatchError);
  });

  it("rejects same SHA with conflicting dataFormat refs", () => {
    const catalog = createMemoryLiveAssetCatalog();
    const byteStore = createMemoryLiveAssetByteStore();
    const doc = customProcedureFixtureDocument();
    seedDocumentAssets(catalog, byteStore, ORG, doc);
    const costume0 = doc.targets[0]!.costumes![0]!;
    doc.targets[0]!.costumes!.push({
      ...costume0,
      name: "backdrop2",
      dataFormat: "jpeg",
      md5ext: `${costume0.assetId}.jpg`,
    });

    expect(() =>
      collectCommitAssetExpectations(doc, byteStore),
    ).toThrow(AssetRefMismatchError);
  });
});
