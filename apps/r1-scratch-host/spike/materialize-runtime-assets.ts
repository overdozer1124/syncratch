import type { AdapterHandle } from "@blocksync/scratch-adapter";

/** Ensure runtime costume/sound assets carry bytes before saveProjectSb3(). */
export function materializeRuntimeAssets(
  handle: AdapterHandle,
  assets: Map<string, Uint8Array>,
): void {
  const storage = handle.vm.runtime.storage;
  if (!storage) {
    throw new Error("materializeRuntimeAssets: VM has no storage attached");
  }

  for (const target of handle.vm.runtime.targets ?? []) {
    for (const costume of target.sprite?.costumes ?? []) {
      const md5ext = `${costume.assetId}.${String(costume.dataFormat).toLowerCase()}`;
      const bytes = assets.get(md5ext);
      if (!bytes) continue;
      const type =
        String(costume.dataFormat).toLowerCase() === "svg"
          ? storage.AssetType.ImageVector
          : storage.AssetType.ImageBitmap;
      const fmt =
        String(costume.dataFormat).toLowerCase() === "svg"
          ? storage.DataFormat.SVG
          : storage.DataFormat.PNG;
      costume.asset = storage.createAsset(type, fmt, bytes, costume.assetId, false);
    }

    for (const sound of target.sprite?.sounds ?? []) {
      const fmtStr = String(sound.dataFormat).toLowerCase();
      const md5ext = `${sound.assetId}.${fmtStr}`;
      const bytes = assets.get(md5ext);
      if (!bytes) continue;
      const fmt = fmtStr === "mp3" ? storage.DataFormat.MP3 : storage.DataFormat.WAV;
      sound.asset = storage.createAsset(
        storage.AssetType.Sound,
        fmt,
        bytes,
        sound.assetId,
        false,
      );
    }
  }
}
