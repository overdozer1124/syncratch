export interface RuntimeAsset {
  assetId?: string;
  dataFormat?: string;
  asset?: {
    data?: Uint8Array | ArrayBuffer;
  };
}

export interface RuntimeAssetTarget {
  sprite?: {
    costumes?: RuntimeAsset[];
    sounds?: RuntimeAsset[];
  };
}

function copyBytes(data: Uint8Array | ArrayBuffer): Uint8Array {
  return data instanceof Uint8Array
    ? new Uint8Array(data)
    : new Uint8Array(data.slice(0));
}

export function collectRuntimeAssetBytes(
  existing: Map<string, Uint8Array>,
  targets: RuntimeAssetTarget[],
): Map<string, Uint8Array> {
  const assets = new Map(
    [...existing].map(([md5ext, bytes]) => [md5ext, copyBytes(bytes)] as const),
  );
  for (const target of targets) {
    const runtimeAssets = [
      ...(target.sprite?.costumes ?? []),
      ...(target.sprite?.sounds ?? []),
    ];
    for (const runtimeAsset of runtimeAssets) {
      const assetId = runtimeAsset.assetId;
      const rawDataFormat = runtimeAsset.dataFormat?.toLowerCase();
      const dataFormat = rawDataFormat === "jpeg" ? "jpg" : rawDataFormat;
      const data = runtimeAsset.asset?.data;
      if (!assetId || !dataFormat || !data) continue;
      const bytes = copyBytes(data);
      if (bytes.byteLength === 0) continue;
      assets.set(`${assetId}.${dataFormat}`, bytes);
    }
  }
  return assets;
}
