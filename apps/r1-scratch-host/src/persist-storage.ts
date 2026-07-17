/**
 * §7.3: project-scoped asset GET → storage.createAsset (never img/src URL).
 */

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AdapterHandle } from "@blocksync/scratch-adapter";
import type { PersistClient } from "./persist-client.js";
import type { AssetIndexEntry } from "./document-bridge.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const nodeRequire = createRequire(import.meta.url);

type ScratchStorageInstance = {
  AssetType: {
    Sound: unknown;
    ImageVector: unknown;
    ImageBitmap: unknown;
  };
  DataFormat: {
    SVG: string;
    WAV: string;
    MP3: string;
    PNG: string;
  };
  addHelper: (helper: {
    load: (
      assetType: unknown,
      assetId: string,
      dataFormat: string,
    ) => Promise<unknown>;
  }) => void;
  createAsset: (
    type: unknown,
    format: string,
    bytes: Uint8Array,
    id: string,
    generateMd5: boolean,
  ) => unknown;
};

type ScratchStorageMod = {
  ScratchStorage: new () => ScratchStorageInstance;
};

function assetTypeForFormat(
  storage: ScratchStorageInstance,
  dataFormat: string,
): unknown {
  const fmt = dataFormat.toLowerCase();
  if (fmt === "wav" || fmt === "mp3") return storage.AssetType.Sound;
  if (fmt === "svg") return storage.AssetType.ImageVector;
  return storage.AssetType.ImageBitmap;
}

function dataFormatEnum(
  storage: ScratchStorageInstance,
  dataFormat: string,
): string {
  const fmt = dataFormat.toLowerCase();
  if (fmt === "svg") return storage.DataFormat.SVG;
  if (fmt === "wav") return storage.DataFormat.WAV;
  if (fmt === "mp3") return storage.DataFormat.MP3;
  return storage.DataFormat.PNG;
}

export function attachPersistStorage(
  handle: AdapterHandle,
  args: {
    client: PersistClient;
    projectId: string;
    assetIndex: Map<string, AssetIndexEntry>;
  },
): void {
  const storagePath = join(
    repoRoot,
    "vendor/scratch-editor/node_modules/scratch-storage",
  );
  if (!existsSync(storagePath)) {
    throw new Error("scratch-storage missing — run npm ci in vendor/scratch-editor");
  }
  const mod = nodeRequire(storagePath) as ScratchStorageMod;
  const ScratchStorage = mod.ScratchStorage;
  const storage = new ScratchStorage();

  storage.addHelper({
    load(assetType: unknown, assetId: string, dataFormat: string) {
      const entry = args.assetIndex.get(assetId);
      if (!entry) return Promise.resolve(null);

      const expectedType = assetTypeForFormat(storage, entry.dataFormat);
      const expectedFormat = dataFormatEnum(storage, entry.dataFormat);
      const typeName = (assetType as { name?: string })?.name ?? String(assetType);
      const expectedTypeName =
        (expectedType as { name?: string })?.name ?? String(expectedType);
      if (typeName !== expectedTypeName) return Promise.resolve(null);
      if (String(dataFormat).toLowerCase() !== expectedFormat.toLowerCase()) {
        return Promise.resolve(null);
      }

      return args.client
        .getAssetBytes(args.projectId, entry.contentSha256)
        .then((bytes) =>
          storage.createAsset(expectedType, expectedFormat, bytes, assetId, false),
        );
    },
  });

  handle.vm.attachStorage(storage);
}
