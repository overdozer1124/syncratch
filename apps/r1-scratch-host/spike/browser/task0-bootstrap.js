/* global GUI */
(function bootstrapTask0Host() {
  const spike = {
    ready: false,
    error: null,
    vm: null,
  };
  window.__blocksyncTask0 = spike;

  function decodeAssets(map) {
    const out = new Map();
    for (const [md5ext, b64] of Object.entries(map)) {
      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      out.set(md5ext, bytes);
    }
    return out;
  }

  function attachStorage(vm, assets) {
    const { ScratchStorage } = GUI;
    const storage = new ScratchStorage();

    function extFromFormat(dataFormat) {
      const fmt = String(dataFormat).toLowerCase();
      if (fmt === "svg") return "svg";
      if (fmt === "wav") return "wav";
      if (fmt === "mp3") return "mp3";
      return "png";
    }

    storage.addHelper({
      load(assetType, assetId, dataFormat) {
        const ext = extFromFormat(dataFormat);
        const md5ext = `${assetId}.${ext}`;
        const bytes = assets.get(md5ext);
        if (!bytes) return Promise.resolve(null);

        const isSound = ext === "wav" || ext === "mp3";
        const type = isSound
          ? storage.AssetType.Sound
          : ext === "svg"
            ? storage.AssetType.ImageVector
            : storage.AssetType.ImageBitmap;
        const fmt =
          ext === "svg"
            ? storage.DataFormat.SVG
            : ext === "wav"
              ? storage.DataFormat.WAV
              : ext === "mp3"
                ? storage.DataFormat.MP3
                : storage.DataFormat.PNG;

        const typeName = assetType?.name ?? String(assetType);
        const expectedName = type?.name ?? String(type);
        if (typeName !== expectedName) return Promise.resolve(null);

        return Promise.resolve(storage.createAsset(type, fmt, bytes, assetId, false));
      },
    });

    vm.attachStorage(storage);
  }

  function isOrangePixel(extraction) {
    const color = extraction?.color ?? extraction;
    if (!color || color.a < 16) return false;
    return color.r > 200 && color.g > 120 && color.g < 200 && color.b < 80;
  }

  function stageHasOrangeCat(renderer) {
    const canvas = renderer.canvas;
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    if (!width || !height) return false;

    for (let u = 0.25; u <= 0.75; u += 0.25) {
      for (let v = 0.25; v <= 0.75; v += 0.25) {
        const color = renderer.extractColor(width * u, height * v, 12);
        if (isOrangePixel(color)) return true;
      }
    }
    return false;
  }

  function waitForRenderer(vm, timeoutMs) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const renderer = vm.runtime.renderer;
        if (renderer?.canvas) {
          resolve(renderer);
          return;
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error("Renderer not ready"));
          return;
        }
        requestAnimationFrame(tick);
      };
      tick();
    });
  }

  function waitForStagePixels(vm, timeoutMs) {
    return new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        const renderer = vm.runtime.renderer;
        if (!renderer?.canvas) {
          if (Date.now() - start > timeoutMs) {
            reject(new Error("Renderer not ready"));
            return;
          }
          requestAnimationFrame(tick);
          return;
        }

        vm.renderer.draw();
        requestAnimationFrame(() => {
          if (stageHasOrangeCat(renderer)) {
            resolve(true);
            return;
          }
          if (Date.now() - start > timeoutMs) {
            reject(new Error("Timed out waiting for rendered costume pixels"));
            return;
          }
          requestAnimationFrame(tick);
        });
      };
      tick();
    });
  }

  spike.runBlockMutationSmoke = function runBlockMutationSmoke() {
    const vm = spike.vm;
    const target = vm.runtime.targets.find((t) => !t.isStage);
    if (!target) throw new Error("Sprite target missing");

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
      x: 10,
      y: 10,
    });
    blocks.createBlock({
      id: "move",
      opcode: "motion_movesteps",
      next: null,
      parent: "hat",
      inputs: { STEPS: [1, [4, "3"]] },
      fields: {},
      shadow: false,
      topLevel: false,
    });
    blocks.getBlock("hat").next = "move";
    blocks.getBlock("move").inputs.STEPS = [1, [4, "7"]];

    const json = JSON.parse(vm.toJSON());
    const spriteBlocks = json.targets.find((t) => t.name === "Sprite1").blocks;
    if (!spriteBlocks.hat || spriteBlocks.move.parent !== "hat") {
      throw new Error("Block connect failed in GUI vm");
    }
    if (blocks.getBlock("move").inputs.STEPS[1][1] !== "7") {
      throw new Error("Block input edit failed in GUI vm");
    }

    blocks.deleteBlock("move");
    blocks.deleteBlock("hat");
    const after = JSON.parse(vm.toJSON()).targets.find((t) => t.name === "Sprite1")
      .blocks;
    if (Object.keys(after).length !== 0) {
      throw new Error("Block delete failed in GUI vm");
    }
    return true;
  };

  spike.stageHasOrangeCat = function stageHasOrangeCatFromVm() {
    const renderer = spike.vm?.runtime?.renderer;
    if (!renderer) return false;
    spike.vm.renderer.draw();
    return stageHasOrangeCat(renderer);
  };

  async function main() {
    const [assetsRes, projectRes] = await Promise.all([
      fetch("/fixtures/assets.b64.json"),
      fetch("/fixtures/cat-project.json"),
    ]);
    if (!assetsRes.ok || !projectRes.ok) {
      throw new Error("Failed to load browser spike fixtures");
    }
    const assetsMap = decodeAssets(await assetsRes.json());
    const project = await projectRes.json();

    const state = new GUI.EditorState({ isEmbedded: true });
    const root = GUI.createStandaloneRoot(state, document.getElementById("app"));

    root.render({
      canEditTitle: false,
      canSave: false,
      isEmbedded: true,
      onVmInit: (vm) => {
        attachStorage(vm, assetsMap);
        waitForRenderer(vm, 45_000)
          .then(() => vm.loadProject(JSON.stringify(project)))
          .then(() => {
            spike.vm = vm;
            return waitForStagePixels(vm, 45_000);
          })
          .then(() => {
            spike.ready = true;
          })
          .catch((err) => {
            spike.error = String(err?.message ?? err);
          });
      },
    });
  }

  main().catch((err) => {
    spike.error = String(err?.message ?? err);
  });
})();
