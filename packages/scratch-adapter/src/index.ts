/**
 * @experimental Gate 0 Scratch VM adapter.
 * Prefer published @scratch/scratch-vm@14.1.0 matching vendor pin; source lives in vendor/.
 * Do not patch vendor — runtime wrapping only. If a vendor source patch is required, STOP.
 */

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

export type Gate0Opcode = (typeof GATE0_OPCODES)[number];

/** Visual step opcodes (reporters are evaluated inside parent). */
export const VISUAL_STEP_OPCODES = new Set<string>([
  "event_whenflagclicked",
  "motion_movesteps",
  "motion_gotoxy",
  "looks_say",
  "control_if",
  "control_repeat",
  "data_setvariableto",
]);

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
}

function roundCoord(n: number): number {
  // Documented rounding for parity compares
  return Math.round(n * 1e6) / 1e6;
}

async function loadVmCtor(): Promise<any> {
  // Gate 0: published @scratch/scratch-vm@14.1.0 node webpack build fails under
  // current Node/pnpm (missing assets / `implementation is not a constructor`).
  // Source remains pinned in vendor at v14.1.0 for AGPL. Headless tests use the
  // maintained classic `scratch-vm` CJS entry (same Scratch engine family) via
  // createRequire — recorded in INTERNAL_API_DEPS.md and GO_NO_GO.md.
  const { createRequire } = await import("node:module");
  const { fileURLToPath } = await import("node:url");
  const require = createRequire(fileURLToPath(import.meta.url));
  const mod = require("scratch-vm");
  return mod.default ?? mod;
}

/**
 * Minimal SB3-like project JSON for Gate 0 motion/variable scripts.
 */
export function buildMotionProject(opts: {
  steps: number;
  variableName?: string;
  variableValue?: string;
}): Record<string, unknown> {
  const varId = "var-score";
  const varName = opts.variableName ?? "score";
  return {
    targets: [
      {
        isStage: true,
        name: "Stage",
        variables: { [varId]: [varName, Number(opts.variableValue ?? 0)] },
        lists: {},
        broadcasts: {},
        blocks: {},
        comments: {},
        currentCostume: 0,
        costumes: [
          {
            name: "backdrop1",
            dataFormat: "svg",
            assetId: "cd21514d0531fdffb22204e0ec5ed84a",
            md5ext: "cd21514d0531fdffb22204e0ec5ed84a.svg",
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
            assetId: "cd21514d0531fdffb22204e0ec5ed84a",
            md5ext: "cd21514d0531fdffb22204e0ec5ed84a.svg",
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
    meta: { semver: "3.0.0", vm: "0.2.0", agent: "blocksync-gate0" },
  };
}

export async function createAdapter(): Promise<AdapterHandle> {
  const VirtualMachine = await loadVmCtor();
  const vm = new VirtualMachine();
  vm.setCompatibilityMode(false);
  vm.setTurboMode(false);
  // Avoid renderer/storage dependencies for headless Gate 0
  if (typeof vm.clear === "function") {
    /* noop */
  }

  const observe = (): RuntimeSnapshot => {
    const rt = vm.runtime;
    const threads: ThreadObservation[] = (rt.threads ?? []).map((t: any) => ({
      status: t.status,
      targetName: t.target?.getName?.() ?? t.target?.sprite?.name ?? null,
      blockId: t.peekStack?.() ?? null,
    }));
    const active = (rt.threads ?? []).find(
      (t: any) => t.status === 0 /* RUNNING */ || t.peekStack?.(),
    );
    const currentBlockId = active?.peekStack?.() ?? null;
    let nextBlockId: string | null = null;
    if (active?.target && currentBlockId) {
      nextBlockId =
        active.target.blocks.getNextBlock(currentBlockId) ?? null;
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
      const vars = t.variables ?? {};
      for (const v of Object.values(vars) as any[]) {
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

  const pump = async () => {
    // Drive runtime clock without requestAnimationFrame
    const rt = vm.runtime;
    if (typeof rt._step === "function") {
      rt._step();
    } else if (typeof (vm as any).runtime.step === "function") {
      (vm as any).runtime.step();
    }
  };

  const runToEnd = async (maxSteps = 5000): Promise<RuntimeSnapshot> => {
    const rt = vm.runtime;
    greenFlag();
    // If greenFlag did not enqueue threads yet, start hats explicitly
    if ((rt.threads ?? []).length === 0 && typeof rt.startHats === "function") {
      rt.startHats("event_whenflagclicked");
    }
    const seq = rt.sequencer;
    const stepThread = seq.stepThread.bind(seq);
    for (let i = 0; i < maxSteps; i++) {
      const threads = [...(rt.threads ?? [])];
      const active = threads.filter((t: any) => t.status !== 4);
      if (active.length === 0) break;
      for (const t of active) {
        stepThread(t);
      }
    }
    return observe();
  };

  /**
   * One visual step: execute a single command/hat/control boundary via
   * runtime wrapping of sequencer.stepThread (does not modify vendor sources).
   */
  const stepVisual = async (): Promise<RuntimeSnapshot> => {
    const rt = vm.runtime;
    if ((rt.threads ?? []).length === 0) {
      greenFlag();
    }
    const seq = rt.sequencer;
    const thread =
      (rt.threads ?? []).find((t: any) => t.status === 0 || t.peekStack?.()) ??
      null;
    if (!thread) return observe();

    const before = thread.peekStack?.();
    const original = seq.stepThread.bind(seq);
    let visualOps = 0;
    seq.stepThread = (t: any) => {
      const go = t.goToNextBlock.bind(t);
      t.goToNextBlock = () => {
        visualOps += 1;
        go();
        // Yield after advancing past one visual command
        t.status = 3; /* STATUS_YIELD_TICK */
      };
      try {
        original(t);
      } finally {
        t.goToNextBlock = go;
      }
    };
    try {
      await pump();
      // If hat/execute didn't call goToNextBlock (e.g. still on block), force one execute cycle
      if (visualOps === 0 && thread.peekStack?.() === before) {
        original(thread);
      }
    } finally {
      seq.stepThread = original;
    }
    return observe();
  };

  return {
    vm,
    observe,
    greenFlag,
    runToEnd,
    stepVisual,
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
