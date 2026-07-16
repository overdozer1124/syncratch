import { it, expect } from "vitest";
import { createAdapter, loadProjectJson } from "@blocksync/scratch-adapter";
import { attachAssetBytes } from "./storage-bytes.js";
import { spikeAssetBundle, sha256Hex, SPIKE_BACKDROP_SVG } from "./assets.js";
import { buildCatWithSoundSb3 } from "./project-fixtures.js";
import { materializeRuntimeAssets } from "./materialize-runtime-assets.js";
import { exportSb3Bytes } from "./sb3-round-trip.js";
import JSZip from "jszip";

it("materialize + sb3 export preserves costume bytes", async () => {
  const assets = spikeAssetBundle();
  const handle = await createAdapter();
  attachAssetBytes(handle, assets);
  await loadProjectJson(handle, buildCatWithSoundSb3());
  materializeRuntimeAssets(handle, assets);

  const stage = handle.vm.runtime.targets.find((t: { isStage: boolean }) => t.isStage)!;
  const backdropBytes = stage.sprite.costumes[0].asset.data as Uint8Array;
  expect(sha256Hex(backdropBytes)).toBe(
    sha256Hex(new TextEncoder().encode(SPIKE_BACKDROP_SVG)),
  );

  const sb3 = await exportSb3Bytes(handle);
  const zip = await JSZip.loadAsync(sb3);
  const backdropId = stage.sprite.costumes[0].assetId;
  const file = zip.file(`${backdropId}.svg`);
  expect(file).toBeTruthy();
  const exported = await file!.async("uint8array");
  expect(sha256Hex(exported)).toBe(sha256Hex(backdropBytes));

  handle.dispose();
});
