import JSZip from "jszip";
import type { AdapterHandle } from "@blocksync/scratch-adapter";

type ZipCostumeMeta = {
  name?: string;
  assetId?: string;
  md5ext?: string;
  dataFormat?: string;
};

type ZipSoundMeta = {
  name?: string;
  assetId?: string;
  md5ext?: string;
  dataFormat?: string;
};

/**
 * Headless SB3 import skips costume decode without a renderer and may rewrite assetIds.
 * Re-attach bytes from the SB3 zip using project.json md5ext refs.
 */
export async function materializeAssetsFromSb3Zip(
  handle: AdapterHandle,
  sb3: Uint8Array,
): Promise<void> {
  const storage = handle.vm.runtime.storage;
  if (!storage) {
    throw new Error("materializeAssetsFromSb3Zip: VM has no storage attached");
  }

  const zip = await JSZip.loadAsync(sb3);
  const projectFile = zip.file("project.json");
  if (!projectFile) {
    throw new Error("materializeAssetsFromSb3Zip: sb3 missing project.json");
  }
  const project = JSON.parse(await projectFile.async("string")) as {
    targets?: Array<{
      name?: string;
      isStage?: boolean;
      costumes?: ZipCostumeMeta[];
      sounds?: ZipSoundMeta[];
    }>;
  };

  for (const targetMeta of project.targets ?? []) {
    const rtTarget = (handle.vm.runtime.targets ?? []).find(
      (rt: { getName?: () => string; isStage?: boolean }) =>
        (rt.getName?.() ?? "") === targetMeta.name &&
        Boolean(rt.isStage) === Boolean(targetMeta.isStage),
    );
    if (!rtTarget?.sprite) continue;

    for (let i = 0; i < (targetMeta.costumes ?? []).length; i++) {
      const meta = targetMeta.costumes![i]!;
      const md5ext = String(meta.md5ext ?? `${meta.assetId}.${meta.dataFormat}`);
      const zipEntry = zip.file(md5ext);
      if (!zipEntry) {
        throw new Error(`materializeAssetsFromSb3Zip: sb3 zip missing ${md5ext}`);
      }
      const bytes = new Uint8Array(await zipEntry.async("uint8array"));
      const dataFormat = String(meta.dataFormat ?? "svg").toLowerCase();
      const assetId = md5ext.replace(/\.[^.]+$/, "");
      const type =
        dataFormat === "svg"
          ? storage.AssetType.ImageVector
          : storage.AssetType.ImageBitmap;
      const fmt =
        dataFormat === "svg" ? storage.DataFormat.SVG : storage.DataFormat.PNG;

      const costume = rtTarget.sprite.costumes[i];
      if (!costume) {
        throw new Error(
          `materializeAssetsFromSb3Zip: runtime missing costume index ${i} on ${targetMeta.name}`,
        );
      }
      costume.assetId = assetId;
      costume.md5 = md5ext;
      costume.dataFormat = dataFormat;
      costume.asset = storage.createAsset(type, fmt, bytes, assetId, false);
    }

    for (let i = 0; i < (targetMeta.sounds ?? []).length; i++) {
      const meta = targetMeta.sounds![i]!;
      const md5ext = String(meta.md5ext ?? `${meta.assetId}.${meta.dataFormat}`);
      const zipEntry = zip.file(md5ext);
      if (!zipEntry) {
        throw new Error(`materializeAssetsFromSb3Zip: sb3 zip missing ${md5ext}`);
      }
      const bytes = new Uint8Array(await zipEntry.async("uint8array"));
      const dataFormat = String(meta.dataFormat ?? "wav").toLowerCase();
      const assetId = md5ext.replace(/\.[^.]+$/, "");
      const fmt =
        dataFormat === "mp3" ? storage.DataFormat.MP3 : storage.DataFormat.WAV;

      const sound = rtTarget.sprite.sounds[i];
      if (!sound) {
        throw new Error(
          `materializeAssetsFromSb3Zip: runtime missing sound index ${i} on ${targetMeta.name}`,
        );
      }
      sound.assetId = assetId;
      sound.md5 = md5ext;
      sound.dataFormat = dataFormat;
      sound.asset = storage.createAsset(
        storage.AssetType.Sound,
        fmt,
        bytes,
        assetId,
        false,
      );
    }
  }
}
