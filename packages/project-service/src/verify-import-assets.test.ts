import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { customProcedureFixtureDocument } from "@blocksync/project-envelope";
import type { ProjectDocument, SoundRef } from "@blocksync/project-schema";
import {
  ImportPreconditionError,
  verifyImportAssetBundle,
} from "./index.js";
import { createMemoryLiveAssetByteStore } from "./memory-assets.js";
import { minimalWavBytes } from "./test-wav-fixtures.js";

function soundDocument(bytes: Uint8Array, rate: number, sampleCount: number): ProjectDocument {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const assetId = createHash("md5").update(bytes).digest("hex");
  const sound: SoundRef = {
    kind: "sound",
    name: "pop",
    assetId,
    md5ext: `${assetId}.wav`,
    dataFormat: "wav",
    contentSha256: sha256,
    rate,
    sampleCount,
    format: "",
  };
  const doc = customProcedureFixtureDocument();
  doc.targets[0]!.sounds = [sound];
  return doc;
}

describe("verifyImportAssetBundle", () => {
  it("rejects metadata mismatch against envelope ref", () => {
    const bytes = minimalWavBytes({ sampleCount: 1032, rate: 44100 });
    const doc = soundDocument(bytes, 44100, 1032);
    const sha = doc.targets[0]!.sounds![0]!.contentSha256;
    const byteStore = createMemoryLiveAssetByteStore();
    byteStore.files.set(sha, bytes);

    expect(() =>
      verifyImportAssetBundle(
        doc,
        [
          {
            sha256: sha,
            byteLength: bytes.length,
            md5Hex: "f".repeat(32),
            dataFormat: "png",
          },
        ],
        byteStore,
      ),
    ).toThrow(ImportPreconditionError);
  });

  it("rejects fake WAV bytes for a WAV ref", () => {
    const bytes = minimalWavBytes({ sampleCount: 1032, rate: 44100 });
    const doc = soundDocument(bytes, 44100, 1032);
    const sha = doc.targets[0]!.sounds![0]!.contentSha256;
    const byteStore = createMemoryLiveAssetByteStore();
    const fake = new TextEncoder().encode("definitely not a WAV file");
    byteStore.files.set(sha, fake);

    expect(() =>
      verifyImportAssetBundle(
        doc,
        [
          {
            sha256: sha,
            byteLength: fake.length,
            md5Hex: doc.targets[0]!.sounds![0]!.assetId,
            dataFormat: "wav",
          },
        ],
        byteStore,
      ),
    ).toThrow(ImportPreconditionError);
  });

  it("rejects extra asset objects", () => {
    const doc = customProcedureFixtureDocument();
    const byteStore = createMemoryLiveAssetByteStore();
    expect(() =>
      verifyImportAssetBundle(
        doc,
        [
          {
            sha256: "a".repeat(64),
            byteLength: 1,
            md5Hex: "b".repeat(32),
            dataFormat: "svg",
          },
        ],
        byteStore,
      ),
    ).toThrow(ImportPreconditionError);
  });

  it("rejects when ref and object md5 match but CAS bytes md5 differs", () => {
    const bytes = minimalWavBytes({ sampleCount: 1032, rate: 44100 });
    const doc = soundDocument(bytes, 44100, 1032);
    const sha = doc.targets[0]!.sounds![0]!.contentSha256;
    const claimedMd5 = "4f38e8130ecd3815fae7c1250bcae067";
    doc.targets[0]!.sounds![0]!.assetId = claimedMd5;
    doc.targets[0]!.sounds![0]!.md5ext = `${claimedMd5}.wav`;

    const byteStore = createMemoryLiveAssetByteStore();
    byteStore.files.set(sha, bytes);

    expect(() =>
      verifyImportAssetBundle(
        doc,
        [
          {
            sha256: sha,
            byteLength: bytes.length,
            md5Hex: claimedMd5,
            dataFormat: "wav",
          },
        ],
        byteStore,
      ),
    ).toThrow(ImportPreconditionError);

    const actualMd5 = createHash("md5").update(bytes).digest("hex");
    expect(actualMd5).not.toBe(claimedMd5);
  });
});
