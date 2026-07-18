import {describe, expect, it, vi} from "vitest";
import {
  exportSb3,
  loadSb3,
  projectJsonToDocument,
  sha256Hex,
} from "@blocksync/sb3-tools/browser";
import {createMemoryAssetLoader} from "./scratch-storage-loader.js";

describe("createMemoryAssetLoader", () => {
  it("exports, reloads, and loads jpg/jpeg assets with DataFormat.JPG", async () => {
    const imageBitmap = {name: "ImageBitmap"};
    const jpg = "jpg-format";
    const createAsset = vi.fn(
      (
        assetType: unknown,
        dataFormat: string,
        bytes: Uint8Array,
        assetId: string,
      ) => ({assetType, dataFormat, bytes, assetId}),
    );
    const storage = {
      AssetType: {
        Sound: {name: "Sound"},
        ImageVector: {name: "ImageVector"},
        ImageBitmap: imageBitmap,
      },
      DataFormat: {
        SVG: "svg-format",
        WAV: "wav-format",
        MP3: "mp3-format",
        PNG: "png-format",
        JPG: jpg,
      },
      createAsset,
    };
    const bytes = new Uint8Array([
      0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01,
      0x01, 0x00, 0x00, 0xff, 0xd9,
    ]);
    const assetId = "17764e741383c30589ea22b632677b44";
    const md5ext = `${assetId}.jpg`;
    const assets = new Map([[md5ext, bytes]]);
    const document = projectJsonToDocument(
      {
        targets: [{
          isStage: true,
          name: "Stage",
          variables: {},
          lists: {},
          broadcasts: {},
          blocks: {},
          comments: {},
          currentCostume: 0,
          costumes: [{
            name: "backdrop",
            assetId,
            md5ext,
            dataFormat: "jpg",
            rotationCenterX: 0,
            rotationCenterY: 0,
          }],
          sounds: [],
          volume: 100,
          layerOrder: 0,
          tempo: 60,
          videoTransparency: 50,
          videoState: "on",
          textToSpeechLanguage: null,
        }],
        monitors: [],
        extensions: [],
      },
      new Map([[md5ext, sha256Hex(bytes)]]),
    );
    const reloaded = await loadSb3(await exportSb3(document, assets));
    expect(reloaded.ok).toBe(true);
    const load = createMemoryAssetLoader(
      storage,
      reloaded.assets!,
    );

    await expect(load(imageBitmap, assetId, "jpeg")).resolves.toMatchObject({
      dataFormat: jpg,
      assetId,
    });
    await expect(load(imageBitmap, assetId, "jpg")).resolves.toMatchObject({
      dataFormat: jpg,
      assetId,
    });
    expect(createAsset).toHaveBeenCalledTimes(2);
    expect(createAsset).toHaveBeenNthCalledWith(
      1,
      imageBitmap,
      jpg,
      bytes,
      assetId,
      false,
    );
  });
});
