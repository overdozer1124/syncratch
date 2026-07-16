import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAdapter,
  loadProjectJson,
  VENDOR_VM_DIST,
} from "@blocksync/scratch-adapter";
import { attachAssetBytes } from "./storage-bytes.js";
import { spikeAssetBundle } from "./assets.js";
import {
  buildCatWithSoundSb3,
  buildCustomProcedureSb3,
} from "./project-fixtures.js";
import { vmToDocumentSpikeV0 } from "./vm-to-document-spike-v0.js";
import {
  equivalenceSpikeV0,
  buildExpectedCustomProcedureDocument,
} from "./equivalence-spike-v0.js";
import { loadFixtureJson } from "./project-fixtures.js";
import {
  roundTripDocument,
  documentAfterFirstLoad,
  assertFullProcedureMutation,
  findProcedurePrototype,
} from "./sb3-round-trip.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const VENDOR_GUI_STANDALONE = join(
  repoRoot,
  "vendor/scratch-editor/packages/scratch-gui/dist/scratch-gui-standalone.js",
);

const EXPECTED_PROCEDURE_MUTATION = {
  tagName: "mutation",
  children: [],
  proccode: "my block %s",
  argumentids: '["arg_id"]',
  argumentnames: '["x"]',
  argumentdefaults: '[""]',
  warp: "false",
};

describe("Task 0 Scratch integration spike", () => {
  it("loads vendor VM pin without submodule patch", async () => {
    expect(existsSync(VENDOR_VM_DIST)).toBe(true);
    const a = await createAdapter();
    expect(a.runtimeSource).toContain("vendor:@scratch/scratch-vm@14.1.0");
    a.dispose();
  });

  it("loads costumes and sounds via storage.createAsset (§7.3)", async () => {
    const handle = await createAdapter();
    attachAssetBytes(handle, spikeAssetBundle());
    await loadProjectJson(handle, buildCatWithSoundSb3());

    const sprite = handle.vm.runtime.targets.find((t: { isStage: boolean }) => !t.isStage);
    expect(sprite?.sprite?.costumes?.length).toBeGreaterThan(0);
    expect(sprite?.sprite?.costumes?.[0]?.asset?.data).toBeInstanceOf(Uint8Array);
    expect(sprite?.sprite?.sounds?.length).toBe(1);
    expect(sprite?.sprite?.sounds?.[0]?.asset?.data).toBeInstanceOf(Uint8Array);

    const stage = handle.vm.runtime.targets.find((t: { isStage: boolean }) => t.isStage);
    expect(stage?.sprite?.sounds?.length).toBe(1);

    handle.dispose();
  });

  it("persists VM block create, connect, input edit, and delete in runtime state", async () => {
    const handle = await createAdapter();
    attachAssetBytes(handle, spikeAssetBundle());
    await loadProjectJson(handle, buildCatWithSoundSb3());

    const target = handle.vm.runtime.targets.find((t: { isStage: boolean }) => !t.isStage);
    const blocks = target.blocks;

    blocks.createBlock({
      id: "hat",
      opcode: "event_whenflagclicked",
      next: null,
      parent: null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: true,
      x: 12,
      y: 34,
    });
    blocks.createBlock({
      id: "move",
      opcode: "motion_movesteps",
      next: null,
      parent: "hat",
      inputs: { STEPS: [1, [4, "5"]] },
      fields: {},
      shadow: false,
      topLevel: false,
    });
    blocks.getBlock("hat").next = "move";

    let json = JSON.parse(handle.vm.toJSON());
    let spriteBlocks = json.targets.find((t: { name: string }) => t.name === "Sprite1")
      .blocks;
    expect(spriteBlocks.hat).toBeDefined();
    expect(spriteBlocks.move.parent).toBe("hat");

    blocks.getBlock("move").inputs.STEPS = [1, [4, "9"]];
    expect(blocks.getBlock("move").inputs.STEPS[1][1]).toBe("9");

    blocks.deleteBlock("move");
    blocks.deleteBlock("hat");
    json = JSON.parse(handle.vm.toJSON());
    spriteBlocks = json.targets.find((t: { name: string }) => t.name === "Sprite1").blocks;
    expect(Object.keys(spriteBlocks)).toHaveLength(0);

    handle.dispose();
  });

  it("equivalenceSpikeV0 matches cat-with-sound after saveProjectSb3 re-import", async () => {
    const assets = spikeAssetBundle();
    const project = buildCatWithSoundSb3();
    const expected = await documentAfterFirstLoad(project, assets);
    const doc = await roundTripDocument(project, assets);
    expect(equivalenceSpikeV0(doc, expected)).toBe(true);
  });

  it("equivalenceSpikeV0 matches custom-procedure after saveProjectSb3 re-import", async () => {
    const assets = spikeAssetBundle();
    const project = buildCustomProcedureSb3();
    const expected = await documentAfterFirstLoad(project, assets);
    const doc = await roundTripDocument(project, assets);
    expect(equivalenceSpikeV0(doc, expected)).toBe(true);
  });

  it("preserves full custom procedure mutation after saveProjectSb3 re-import", async () => {
    const assets = spikeAssetBundle();
    const doc = await roundTripDocument(buildCustomProcedureSb3(), assets);
    const proto = findProcedurePrototype(doc);
    expect(() =>
      assertFullProcedureMutation(proto?.mutation, EXPECTED_PROCEDURE_MUTATION),
    ).not.toThrow();
  });

  it("committed fixture JSON matches VM first-load baseline", async () => {
    const assets = spikeAssetBundle();
    expect(
      equivalenceSpikeV0(
        loadFixtureJson("cat-with-sound.expected.json"),
        await documentAfterFirstLoad(buildCatWithSoundSb3(), assets),
      ),
    ).toBe(true);
    expect(
      equivalenceSpikeV0(
        loadFixtureJson("custom-procedure.expected.json"),
        await documentAfterFirstLoad(buildCustomProcedureSb3(), assets),
      ),
    ).toBe(true);
  });

  it("runs green flag with a sound block when assets are loaded", async () => {
    const handle = await createAdapter();
    attachAssetBytes(handle, spikeAssetBundle());
    const project = buildCatWithSoundSb3();
    const sprite = (project.targets as unknown[])[1] as Record<string, unknown>;
    sprite.blocks = {
      hat: {
        opcode: "event_whenflagclicked",
        next: "play",
        parent: null,
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: true,
        x: 0,
        y: 0,
      },
      play: {
        opcode: "sound_play",
        next: null,
        parent: "hat",
        inputs: {
          SOUND_MENU: [1, [11, "Meow", "meow-id"]],
        },
        fields: {},
        shadow: false,
        topLevel: false,
      },
    };
    await loadProjectJson(handle, project);
    await handle.runToEnd(500);
    expect(handle.observe().targets[0]?.name).toBe("Sprite1");
    handle.dispose();
  });

  it("requires scratch-gui standalone bundle (no skip)", () => {
    expect(
      existsSync(VENDOR_GUI_STANDALONE),
      `Missing GUI bundle — run: pnpm gate0:build-vendor-gui-spike\n${VENDOR_GUI_STANDALONE}`,
    ).toBe(true);
  });
});
