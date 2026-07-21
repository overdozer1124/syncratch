import {describe, expect, it} from "vitest";
import {collectRuntimeAssetBytes} from "./runtime-assets.js";

describe("collectRuntimeAssetBytes", () => {
  it("merges newly created VM costume and sound bytes into the asset map", () => {
    const existing = new Map([
      ["existing.svg", new Uint8Array([1])],
    ]);
    const targets = [{
      sprite: {
        costumes: [{
          assetId: "costume",
          dataFormat: "jpeg",
          asset: {data: new Uint8Array([2, 3])},
        }],
        sounds: [{
          assetId: "sound",
          dataFormat: "wav",
          asset: {data: new Uint8Array([4, 5]).buffer},
        }],
      },
    }];

    const assets = collectRuntimeAssetBytes(existing, targets);

    expect([...assets]).toEqual([
      ["existing.svg", new Uint8Array([1])],
      ["costume.jpg", new Uint8Array([2, 3])],
      ["sound.wav", new Uint8Array([4, 5])],
    ]);
    expect(assets.get("costume.jpg")).not.toBe(targets[0]!.sprite.costumes[0]!.asset.data);
  });

  it("skips empty costume/sound byte arrays", () => {
    const assets = collectRuntimeAssetBytes(new Map(), [{
      sprite: {
        costumes: [{
          assetId: "empty",
          dataFormat: "svg",
          asset: {data: new Uint8Array()},
        }],
      },
    }]);
    expect(assets.has("empty.svg")).toBe(false);
  });
});
