/**
 * @experimental Gate 0 Scratch VM adapter using vendor-built @scratch/scratch-vm@14.1.0.
 */

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import fs from "node:fs";

export const GATE0_OPCODES = [
  "event_whenflagclicked",
  "motion_movesteps",
  "motion_gotoxy",
  "looks_say",
  "control_if",
  "control_repeat",
  "operator_add",
  "operator_equals",
  "data_setvariableto",
  "data_variable",
] as const;

export interface ThreadObservation {
  status: number;
  targetName: string | null;
  blockId: string | null;
}

export interface RuntimeSnapshot {
  threads: ThreadObservation[];
  currentBlockId: string | null;
  nextBlockId: string | null;
  targets: Array<{
    name: string;
    x: number;
    y: number;
    direction: number;
    visible: boolean;
  }>;
  variables: Record<string, string | number>;
}

export interface AdapterHandle {
  vm: any;
  observe: () => RuntimeSnapshot;
  greenFlag: () => void;
  runToEnd: (maxSteps?: number) => Promise<RuntimeSnapshot>;
  stepVisual: () => Promise<RuntimeSnapshot>;
  dispose: () => void;
  runtimeSource: string;
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
export const VENDOR_VM_DIST = join(
  repoRoot,
  "vendor/scratch-editor/packages/scratch-vm/dist/node/scratch-vm.js",
);

const nodeRequire = createRequire(import.meta.url);

let cssShimInstalled = false;

function installCssFsShim(): void {
  if (cssShimInstalled) return;
  const original = fs.readFileSync.bind(fs);
  (fs as any).readFileSync = (path: fs.PathOrFileDescriptor, options?: any) => {
    const p = String(path).replace(/\\/g, "/");
    if (p.endsWith("browser/default-stylesheet.css") && !existsSync(String(path))) {
      return "/* gate0 fs shim — vendor submodule untouched */\n";
    }
    return original(path, options);
  };
  cssShimInstalled = true;
}

/** Ensure entities/decode resolves for vendor webpack bundle under Node. */
function ensureEntitiesDecode(): void {
  try {
    nodeRequire("entities/decode");
  } catch {
    // Prefer root workspace entities@6; fall back to patching Module
    try {
      const entitiesDecode = nodeRequire(
        join(repoRoot, "node_modules/entities/decode.js"),
      );
      const Module = nodeRequire("node:module");
      const orig = Module._resolveFilename;
      Module._resolveFilename = function (
        request: string,
        parent: unknown,
        isMain: boolean,
        options: unknown,
      ) {
        if (request === "entities/decode") {
          return join(repoRoot, "node_modules/entities/decode.js");
        }
        return orig.call(this, request, parent, isMain, options);
      };
      void entitiesDecode;
    } catch {
      /* will fail later with clear error */
    }
  }
}

function roundCoord(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

function loadVendorVmCtor(): { VirtualMachine: any; source: string } {
  if (!existsSync(VENDOR_VM_DIST)) {
    throw new Error(
      `Vendor VM build missing at ${VENDOR_VM_DIST}. Run: node scripts/build-vendor-scratch-vm.mjs`,
    );
  }
  installCssFsShim();
  ensureEntitiesDecode();
  const mod = nodeRequire(VENDOR_VM_DIST);
  return {
    VirtualMachine: mod.default ?? mod,
    source: `vendor:@scratch/scratch-vm@14.1.0:${VENDOR_VM_DIST}`,
  };
}

const GATE0_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#ccc"/></svg>';

export function buildMotionProject(opts: {
  steps: number;
  variableName?: string;
  variableValue?: string;
}): Record<string, unknown> {
  const varId = "var-score";
  const varName = opts.variableName ?? "score";
  const assetId = createHash("md5").update(GATE0_SVG).digest("hex");
  const md5ext = `${assetId}.svg`;

  return {
    targets: [
      {
        isStage: true,
        name: "Stage",
        // Start at 0 so visual-step tests can observe set-block side effects.
        variables: { [varId]: [varName, 0] },
        lists: {},
        broadcasts: {},
        blocks: {},
        comments: {},
        currentCostume: 0,
        costumes: [
          {
            name: "backdrop1",
            dataFormat: "svg",
            assetId,
            md5ext,
            rotationCenterX: 240,
            rotationCenterY: 180,
          },
        ],
        sounds: [],
        volume: 100,
        layerOrder: 0,
        tempo: 60,
        videoTransparency: 50,
        videoState: "on",
        textToSpeechLanguage: null,
      },
      {
        isStage: false,
        name: "Sprite1",
        variables: {},
        lists: {},
        broadcasts: {},
        blocks: {
          hat: {
            opcode: "event_whenflagclicked",
            next: "set",
            parent: null,
            inputs: {},
            fields: {},
            shadow: false,
            topLevel: true,
            x: 0,
            y: 0,
          },
          set: {
            opcode: "data_setvariableto",
            next: "move",
            parent: "hat",
            inputs: {
              VALUE: [1, [10, String(opts.variableValue ?? "42")]],
            },
            fields: { VARIABLE: [varName, varId] },
            shadow: false,
            topLevel: false,
          },
          move: {
            opcode: "motion_movesteps",
            next: null,
            parent: "set",
            inputs: { STEPS: [1, [4, String(opts.steps)]] },
            fields: {},
            shadow: false,
            topLevel: false,
          },
        },
        comments: {},
        currentCostume: 0,
        costumes: [
          {
            name: "costume1",
            dataFormat: "svg",
            assetId,
            md5ext,
            rotationCenterX: 48,
            rotationCenterY: 50,
          },
        ],
        sounds: [],
        volume: 100,
        layerOrder: 1,
        visible: true,
        x: 0,
        y: 0,
        size: 100,
        direction: 90,
        draggable: false,
        rotationStyle: "all around",
      },
    ],
    monitors: [],
    extensions: [],
    meta: { semver: "3.0.0", vm: "14.1.0", agent: "blocksync-gate0" },
  };
}

function baseTargets(
  spriteBlocks: Record<string, unknown>,
  stageVariables: Record<string, [string, string | number]> = {},
): unknown[] {
  const assetId = createHash("md5").update(GATE0_SVG).digest("hex");
  const md5ext = `${assetId}.svg`;
  return [
    {
      isStage: true,
      name: "Stage",
      variables: stageVariables,
      lists: {},
      broadcasts: {},
      blocks: {},
      comments: {},
      currentCostume: 0,
      costumes: [
        {
          name: "backdrop1",
          dataFormat: "svg",
          assetId,
          md5ext,
          rotationCenterX: 240,
          rotationCenterY: 180,
        },
      ],
      sounds: [],
      volume: 100,
      layerOrder: 0,
      tempo: 60,
      videoTransparency: 50,
      videoState: "on",
      textToSpeechLanguage: null,
    },
    {
      isStage: false,
      name: "Sprite1",
      variables: {},
      lists: {},
      broadcasts: {},
      blocks: spriteBlocks,
      comments: {},
      currentCostume: 0,
      costumes: [
        {
          name: "costume1",
          dataFormat: "svg",
          assetId,
          md5ext,
          rotationCenterX: 48,
          rotationCenterY: 50,
        },
      ],
      sounds: [],
      volume: 100,
      layerOrder: 1,
      visible: true,
      x: 0,
      y: 0,
      size: 100,
      direction: 90,
      draggable: false,
      rotationStyle: "all around",
    },
  ];
}

function projectWithBlocks(
  spriteBlocks: Record<string, unknown>,
  stageVariables: Record<string, [string, string | number]> = {},
): Record<string, unknown> {
  return {
    targets: baseTargets(spriteBlocks, stageVariables),
    monitors: [],
    extensions: [],
    meta: { semver: "3.0.0", vm: "14.1.0", agent: "blocksync-gate0" },
  };
}

/** hat → control_repeat(n) → motion_movesteps */
export function buildRepeatProject(opts: {
  times: number;
  steps: number;
}): Record<string, unknown> {
  return projectWithBlocks({
    hat: {
      opcode: "event_whenflagclicked",
      next: "repeat",
      parent: null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: true,
      x: 0,
      y: 0,
    },
    repeat: {
      opcode: "control_repeat",
      next: null,
      parent: "hat",
      inputs: {
        TIMES: [1, [6, String(opts.times)]],
        SUBSTACK: [2, "move"],
      },
      fields: {},
      shadow: false,
      topLevel: false,
    },
    move: {
      opcode: "motion_movesteps",
      next: null,
      parent: "repeat",
      inputs: { STEPS: [1, [4, String(opts.steps)]] },
      fields: {},
      shadow: false,
      topLevel: false,
    },
  });
}

/** hat → control_if(true) → motion_gotoxy */
export function buildIfGotoxyProject(): Record<string, unknown> {
  return projectWithBlocks({
    hat: {
      opcode: "event_whenflagclicked",
      next: "iff",
      parent: null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: true,
      x: 0,
      y: 0,
    },
    iff: {
      opcode: "control_if",
      next: null,
      parent: "hat",
      inputs: {
        CONDITION: [2, "eq"],
        SUBSTACK: [2, "goto"],
      },
      fields: {},
      shadow: false,
      topLevel: false,
    },
    eq: {
      opcode: "operator_equals",
      next: null,
      parent: "iff",
      inputs: {
        OPERAND1: [1, [10, "1"]],
        OPERAND2: [1, [10, "1"]],
      },
      fields: {},
      shadow: false,
      topLevel: false,
    },
    goto: {
      opcode: "motion_gotoxy",
      next: null,
      parent: "iff",
      inputs: {
        X: [1, [4, "40"]],
        Y: [1, [4, "-5"]],
      },
      fields: {},
      shadow: false,
      topLevel: false,
    },
  });
}

/** hat → looks_say → set(var = add(1,2)) using data_variable in a later step */
export function buildLooksAndOperatorsProject(): Record<string, unknown> {
  const varId = "var-score";
  return projectWithBlocks(
    {
      hat: {
        opcode: "event_whenflagclicked",
        next: "say",
        parent: null,
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: true,
        x: 0,
        y: 0,
      },
      say: {
        opcode: "looks_say",
        next: "set",
        parent: "hat",
        inputs: { MESSAGE: [1, [10, "hi"]] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      set: {
        opcode: "data_setvariableto",
        next: "move",
        parent: "say",
        inputs: {
          VALUE: [3, "add", [10, "0"]],
        },
        fields: { VARIABLE: ["score", varId] },
        shadow: false,
        topLevel: false,
      },
      add: {
        opcode: "operator_add",
        next: null,
        parent: "set",
        inputs: {
          NUM1: [3, "var", [4, "0"]],
          NUM2: [1, [4, "3"]],
        },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      var: {
        opcode: "data_variable",
        next: null,
        parent: "add",
        inputs: {},
        fields: { VARIABLE: ["score", varId] },
        shadow: false,
        topLevel: false,
      },
      move: {
        opcode: "motion_movesteps",
        next: null,
        parent: "set",
        inputs: { STEPS: [1, [4, "8"]] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
    },
    { [varId]: ["score", 0] },
  );
}

/** Default Scratch frame interval (ms). Required before sequencer.stepThreads runs. */
const THREAD_STEP_INTERVAL_MS = 1000 / 30;

function attachInlineStorage(vm: any): void {
  const storagePath = join(
    repoRoot,
    "vendor/scratch-editor/node_modules/scratch-storage",
  );
  if (!existsSync(storagePath)) return;
  const mod = nodeRequire(storagePath);
  const ScratchStorage = mod.ScratchStorage ?? mod.default;
  if (!ScratchStorage) return;
  const storage = new ScratchStorage();
  const svgBytes = new TextEncoder().encode(GATE0_SVG);
  storage.addHelper({
    load(assetType: any, assetId: string, dataFormat: any) {
      const isVector =
        assetType === storage.AssetType.ImageVector ||
        assetType?.name === "ImageVector";
      if (!isVector) return null;
      return Promise.resolve(
        storage.createAsset(
          storage.AssetType.ImageVector,
          dataFormat ?? storage.DataFormat.SVG,
          svgBytes,
          assetId,
          false,
        ),
      );
    },
  });
  vm.attachStorage(storage);
}

export async function createAdapter(): Promise<AdapterHandle> {
  const { VirtualMachine, source } = loadVendorVmCtor();
  const vm = new VirtualMachine();
  vm.setCompatibilityMode(false);
  vm.setTurboMode(false);
  // Without this, WORK_TIME is 0 and _step never executes threads (vendor Runtime default).
  vm.runtime.currentStepTime = THREAD_STEP_INTERVAL_MS;
  attachInlineStorage(vm);

  const observe = (): RuntimeSnapshot => {
    const rt = vm.runtime;
    const threads: ThreadObservation[] = (rt.threads ?? []).map((t: any) => ({
      status: t.status,
      targetName: t.target?.getName?.() ?? t.target?.sprite?.name ?? null,
      blockId: t.peekStack?.() ?? null,
    }));
    const active = (rt.threads ?? []).find(
      (t: any) => t.status === 0 || t.peekStack?.(),
    );
    const currentBlockId = active?.peekStack?.() ?? null;
    let nextBlockId: string | null = null;
    if (active?.target && currentBlockId) {
      nextBlockId = active.target.blocks.getNextBlock(currentBlockId) ?? null;
    }
    const targets = (rt.targets ?? [])
      .filter((t: any) => !t.isStage)
      .map((t: any) => ({
        name: t.getName?.() ?? t.sprite?.name ?? "?",
        x: roundCoord(t.x ?? 0),
        y: roundCoord(t.y ?? 0),
        direction: roundCoord(t.direction ?? 90),
        visible: Boolean(t.visible ?? true),
      }));
    const variables: Record<string, string | number> = {};
    for (const t of rt.targets ?? []) {
      for (const v of Object.values(t.variables ?? {}) as any[]) {
        if (v && typeof v.name === "string") {
          variables[v.name] = v.value as string | number;
        }
      }
    }
    return { threads, currentBlockId, nextBlockId, targets, variables };
  };

  const greenFlag = () => {
    vm.greenFlag();
  };

  /**
   * Normal Scratch execution: greenFlag + Runtime._step frames
   * (same path as vm.start() interval, without starting setInterval).
   */
  const runToEnd = async (maxSteps = 10_000): Promise<RuntimeSnapshot> => {
    const rt = vm.runtime;
    rt.currentStepTime = THREAD_STEP_INTERVAL_MS;
    greenFlag();
    for (let i = 0; i < maxSteps; i++) {
      rt._step();
      const threads = rt.threads ?? [];
      const busy = threads.some((t: any) => t.status !== 4 && t.stack?.length);
      if (!busy) break;
    }
    return observe();
  };

  /** True after a visual-step session started; avoid re-greenFlag after idle. */
  let visualSessionActive = false;

  /**
   * Visual one-block step: Runtime._step / startHats paused after each
   * command/hat/control boundary (design: reporters stay inside parent eval).
   *
   * Boundaries:
   * - goToNextBlock() — linear next
   * - pushStack(non-null) — control_if / control_repeat startBranch, etc.
   *
   * Sequencer only checks YIELD_TICK after execute(), so we throw a sentinel.
   * Wrap must be active during greenFlag() (startHats advances past the hat).
   */
  const stepVisual = async (): Promise<RuntimeSnapshot> => {
    const rt = vm.runtime;
    rt.currentStepTime = THREAD_STEP_INTERVAL_MS;
    if ((rt.threads ?? []).length === 0 && visualSessionActive) {
      return observe();
    }

    const seq = rt.sequencer;
    const originalStepThread = seq.stepThread.bind(seq);
    const originalStepToBranch = seq.stepToBranch.bind(seq);
    const STOP = Symbol("gate0-visual-stop");

    const armThread = (t: any) => {
      if (t._gate0Armed) return;
      let hit = false;
      const stopAfter = () => {
        if (hit) return;
        hit = true;
        t.status = 3; // YIELD_TICK
        throw STOP;
      };
      const go = t.goToNextBlock.bind(t);
      t.goToNextBlock = () => {
        go();
        stopAfter();
      };
      const push = t.pushStack.bind(t);
      t.pushStack = (blockId: string | null) => {
        push(blockId);
        // Branch / procedure entry — control boundary before child executes.
        if (blockId !== null && blockId !== undefined) {
          stopAfter();
        }
      };
      t._gate0Armed = true;
      t._gate0RestoreGo = go;
      t._gate0RestorePush = push;
    };

    const armThreads = () => {
      for (const t of rt.threads ?? []) armThread(t);
    };

    const disarmWraps = () => {
      for (const t of rt.threads ?? []) {
        if (t._gate0RestoreGo) t.goToNextBlock = t._gate0RestoreGo;
        if (t._gate0RestorePush) t.pushStack = t._gate0RestorePush;
        delete t._gate0Armed;
        delete t._gate0RestoreGo;
        delete t._gate0RestorePush;
      }
      seq.stepThread = originalStepThread;
      seq.stepToBranch = originalStepToBranch;
    };

    seq.stepThread = (t: any) => {
      if (t.status === 3) t.status = 0;
      armThread(t);
      try {
        originalStepThread(t);
      } catch (e) {
        if (e !== STOP) throw e;
      }
    };
    seq.stepToBranch = (t: any, branchNum: number, isLoop: boolean) => {
      armThread(t);
      originalStepToBranch(t, branchNum, isLoop);
    };

    try {
      if ((rt.threads ?? []).length === 0) {
        if (visualSessionActive) return observe();
        visualSessionActive = true;
        const pushThread = rt._pushThread.bind(rt);
        rt._pushThread = (...args: any[]) => {
          const thread = pushThread(...args);
          armThread(thread);
          return thread;
        };
        try {
          greenFlag();
        } catch (e) {
          if (e !== STOP) throw e;
        } finally {
          rt._pushThread = pushThread;
        }
        return observe();
      }
      armThreads();
      try {
        rt._step();
      } catch (e) {
        if (e !== STOP) throw e;
      }
      return observe();
    } finally {
      disarmWraps();
    }
  };

  return {
    vm,
    observe,
    greenFlag,
    runToEnd,
    stepVisual,
    runtimeSource: source,
    dispose: () => {
      try {
        vm.quit?.();
      } catch {
        /* ignore */
      }
    },
  };
}

export async function loadProjectJson(
  handle: AdapterHandle,
  project: Record<string, unknown>,
): Promise<void> {
  await handle.vm.loadProject(JSON.stringify(project));
}
