export interface MemoryAssetStorage {
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
    JPG: string;
  };
  createAsset(
    assetType: unknown,
    dataFormat: string,
    bytes: Uint8Array,
    assetId: string,
    generateMd5: boolean,
  ): unknown;
}

function canonicalFormat(dataFormat: string): string {
  const lower = dataFormat.toLowerCase();
  return lower === "jpeg" ? "jpg" : lower;
}

function assetTypeFor(storage: MemoryAssetStorage, format: string): unknown {
  if (format === "wav" || format === "mp3") return storage.AssetType.Sound;
  if (format === "svg") return storage.AssetType.ImageVector;
  return storage.AssetType.ImageBitmap;
}

function dataFormatFor(storage: MemoryAssetStorage, format: string): string {
  if (format === "svg") return storage.DataFormat.SVG;
  if (format === "wav") return storage.DataFormat.WAV;
  if (format === "mp3") return storage.DataFormat.MP3;
  if (format === "jpg") return storage.DataFormat.JPG;
  return storage.DataFormat.PNG;
}

export function createMemoryAssetLoader(
  storage: MemoryAssetStorage,
  assets: Map<string, Uint8Array>,
): (
  requestedType: unknown,
  assetId: string,
  dataFormat: string,
) => Promise<unknown> | null {
  return (requestedType, assetId, dataFormat) => {
    const format = canonicalFormat(String(dataFormat));
    const bytes = assets.get(`${assetId}.${format}`);
    // ScratchStorage only advances to its lower-priority CDN helper when a
    // helper returns null synchronously. Promise.resolve(null) stops the chain.
    if (!bytes || bytes.byteLength === 0) return null;
    const expectedType = assetTypeFor(storage, format);
    const requestedName =
      (requestedType as {name?: string})?.name ?? String(requestedType);
    const expectedName =
      (expectedType as {name?: string})?.name ?? String(expectedType);
    if (requestedName !== expectedName) return null;
    return Promise.resolve(
      storage.createAsset(
        expectedType,
        dataFormatFor(storage, format),
        bytes,
        assetId,
        false,
      ),
    );
  };
}
