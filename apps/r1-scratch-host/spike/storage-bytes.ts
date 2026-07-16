import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AdapterHandle } from "@blocksync/scratch-adapter";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const nodeRequire = createRequire(import.meta.url);

type ScratchStorageMod = {
  ScratchStorage: new () => {
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
};

function extFromFormat(dataFormat: string): string {
  const fmt = dataFormat.toLowerCase();
  if (fmt === "svg") return "svg";
  if (fmt === "wav") return "wav";
  if (fmt === "mp3") return "mp3";
  if (fmt === "png" || fmt === "jpg" || fmt === "jpeg" || fmt === "bmp") return "png";
  throw new Error(`Unsupported spike asset dataFormat: ${dataFormat}`);
}

function resolveAssetEntry(
  assets: Map<string, Uint8Array>,
  assetId: string,
  dataFormat: string,
): { md5ext: string; bytes: Uint8Array } {
  const ext = extFromFormat(dataFormat);
  const md5ext = `${assetId}.${ext}`;
  const bytes = assets.get(md5ext);
  if (!bytes) {
    throw new Error(`Spike asset bundle missing ${md5ext}`);
  }

  const ambiguous = [...assets.keys()].filter((key) => {
    const stem = key.replace(/\.[^.]+$/, "");
    return stem === assetId && key !== md5ext;
  });
  if (ambiguous.length > 0) {
    throw new Error(
      `Ambiguous spike assets for ${assetId}: ${[md5ext, ...ambiguous].join(", ")}`,
    );
  }

  return { md5ext, bytes };
}

function assetTypeForFormat(
  storage: ScratchStorageMod["ScratchStorage"] extends new () => infer T ? T : never,
  dataFormat: string,
): unknown {
  const fmt = dataFormat.toLowerCase();
  if (fmt === "wav" || fmt === "mp3") return storage.AssetType.Sound;
  if (fmt === "svg") return storage.AssetType.ImageVector;
  return storage.AssetType.ImageBitmap;
}

function dataFormatEnum(
  storage: ScratchStorageMod["ScratchStorage"] extends new () => infer T ? T : never,
  dataFormat: string,
): string {
  const fmt = dataFormat.toLowerCase();
  if (fmt === "svg") return storage.DataFormat.SVG;
  if (fmt === "wav") return storage.DataFormat.WAV;
  if (fmt === "mp3") return storage.DataFormat.MP3;
  return storage.DataFormat.PNG;
}

/**
 * §7.3: verified bytes → runtime.storage.createAsset (never img/src URL).
 */
export function attachAssetBytes(
  handle: AdapterHandle,
  assets: Map<string, Uint8Array>,
): void {
  const storagePath = join(
    repoRoot,
    "vendor/scratch-editor/node_modules/scratch-storage",
  );
  if (!existsSync(storagePath)) {
    throw new Error("scratch-storage missing — run npm ci in vendor/scratch-editor");
  }
  const mod = nodeRequire(storagePath) as ScratchStorageMod;
  const ScratchStorage = mod.ScratchStorage ?? (mod as unknown as ScratchStorageMod).ScratchStorage;
  const storage = new ScratchStorage();

  storage.addHelper({
    load(assetType: unknown, assetId: string, dataFormat: string) {
      const { bytes } = resolveAssetEntry(assets, assetId, dataFormat);
      const expectedType = assetTypeForFormat(storage, dataFormat);
      const expectedFormat = dataFormatEnum(storage, dataFormat);

      const typeName = (assetType as { name?: string })?.name ?? String(assetType);
      const expectedTypeName =
        (expectedType as { name?: string })?.name ?? String(expectedType);
      if (typeName !== expectedTypeName) {
        return Promise.resolve(null);
      }
      if (String(dataFormat).toLowerCase() !== expectedFormat.toLowerCase()) {
        return Promise.resolve(null);
      }

      return Promise.resolve(
        storage.createAsset(expectedType, expectedFormat, bytes, assetId, false),
      );
    },
  });

  handle.vm.attachStorage(storage);
}
