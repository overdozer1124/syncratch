import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import type {ProjectDocument} from "@blocksync/project-schema";
import {projectJsonToDocument} from "@blocksync/sb3-tools/browser";
import {installExecutionControl} from "./execution-control.js";
import {installExecutionTrace} from "./execution-trace.js";
import {
  createRewindOrigin,
  installExecutionRewind,
  type ExecutionRewindHandle,
  type RewindOrigin,
} from "./execution-rewind.js";
import {restartGreenFlagHatThreads} from "./execution-rewind-green-flag.js";
import {RewindJournal} from "./execution-rewind-journal.js";

const require = createRequire(import.meta.url);
const SCRATCH_VM_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../vendor/scratch-editor/packages/scratch-vm/dist/node/scratch-vm.js",
);
const CAT_PROJECT_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../apps/r1-scratch-host/spike/browser/fixtures/cat-project.json",
);

export type ScratchVmInstance = {
  runtime: Record<string, unknown> & {
    targets: Array<Record<string, unknown>>;
    threads: unknown[];
    _step?: () => void;
    greenFlag?: () => void;
    on?: (event: string, handler: () => void) => void;
    off?: (event: string, handler: () => void) => void;
  };
  start(): void;
  greenFlag(): void;
  loadProject(input: unknown): Promise<void>;
  toJSON(): string;
};

type MoveScriptOptions = {
  steps?: number[];
  randomTurn?: boolean;
};

type CloneScriptOptions = {
  cloneMoves?: number[];
};

function loadScratchVm(): new () => ScratchVmInstance {
  return require(SCRATCH_VM_PATH) as new () => ScratchVmInstance;
}

function readCatProjectJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(CAT_PROJECT_PATH, "utf8")) as Record<
    string,
    unknown
  >;
}

function attachForeverMoveBounceScript(
  project: Record<string, unknown>,
  stepSize = 10,
): void {
  const targets = project.targets as Array<Record<string, unknown>>;
  const sprite = targets.find(target => target.isStage === false);
  if (!sprite) throw new Error("Sprite target missing in cat-project fixture");
  sprite.blocks = {
    hat: {
      opcode: "event_whenflagclicked",
      next: "loop",
      parent: null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: true,
      x: 0,
      y: 0,
    },
    loop: {
      opcode: "control_forever",
      next: null,
      parent: "hat",
      inputs: {SUBSTACK: [2, "move"]},
      fields: {},
      shadow: false,
      topLevel: false,
    },
    move: {
      opcode: "motion_movesteps",
      next: "bounce",
      parent: "loop",
      inputs: {STEPS: [1, [4, String(stepSize)]]},
      fields: {},
      shadow: false,
      topLevel: false,
    },
    bounce: {
      opcode: "motion_ifonedgebounce",
      next: null,
      parent: "move",
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: false,
    },
  };
}

function attachForeverMoveScript(project: Record<string, unknown>, stepSize = 1): void {
  const targets = project.targets as Array<Record<string, unknown>>;
  const sprite = targets.find(target => target.isStage === false);
  if (!sprite) throw new Error("Sprite target missing in cat-project fixture");
  sprite.blocks = {
    hat: {
      opcode: "event_whenflagclicked",
      next: "loop",
      parent: null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: true,
      x: 0,
      y: 0,
    },
    loop: {
      opcode: "control_forever",
      next: null,
      parent: "hat",
      inputs: {SUBSTACK: [2, "move"]},
      fields: {},
      shadow: false,
      topLevel: false,
    },
    move: {
      opcode: "motion_movesteps",
      next: null,
      parent: "loop",
      inputs: {STEPS: [1, [4, String(stepSize)]]},
      fields: {},
      shadow: false,
      topLevel: false,
    },
  };
}

function attachMoveScript(project: Record<string, unknown>, options: MoveScriptOptions): void {
  const targets = project.targets as Array<Record<string, unknown>>;
  const sprite = targets.find(target => target.isStage === false);
  if (!sprite) throw new Error("Sprite target missing in cat-project fixture");
  const steps = options.steps ?? [10, 5, 3];
  const blocks: Record<string, unknown> = {
    hat: {
      opcode: "event_whenflagclicked",
      next: "move1",
      parent: null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: true,
      x: 0,
      y: 0,
    },
  };
  steps.forEach((value, index) => {
    const id = `move${index + 1}`;
    const waitId = `wait${index + 1}`;
    const nextMove = index < steps.length - 1 ? `move${index + 2}` : null;
    blocks[id] = {
      opcode: "motion_movesteps",
      next: waitId,
      parent: index === 0 ? "hat" : `wait${index}`,
      inputs: {STEPS: [1, [4, String(value)]]},
      fields: {},
      shadow: false,
      topLevel: false,
    };
    blocks[waitId] = {
      opcode: "control_wait",
      next: nextMove,
      parent: id,
      inputs: {DURATION: [1, [4, "0.01"]]},
      fields: {},
      shadow: false,
      topLevel: false,
    };
  });
  if (options.randomTurn) {
    const lastMove = `move${steps.length}`;
    blocks[`${lastMove}Next`] = {
      opcode: "motion_turnright",
      next: null,
      parent: lastMove,
      inputs: {DEGREES: [1, [4, "15"]]},
      fields: {},
      shadow: false,
      topLevel: false,
    };
    (blocks[lastMove] as {next: string}).next = `${lastMove}Next`;
    blocks[`${lastMove}Random`] = {
      opcode: "operator_random",
      next: null,
      parent: `${lastMove}Next`,
      inputs: {
        FROM: [1, [4, "1"]],
        TO: [1, [4, "10"]],
      },
      fields: {},
      shadow: false,
      topLevel: false,
    };
  }
  sprite.blocks = blocks;
}

function attachCloneScript(
  project: Record<string, unknown>,
  options: CloneScriptOptions = {},
): void {
  const targets = project.targets as Array<Record<string, unknown>>;
  const sprite = targets.find(target => target.isStage === false);
  if (!sprite) throw new Error("Sprite target missing in cat-project fixture");
  const cloneMoves = options.cloneMoves ?? [5, 8];
  const blocks: Record<string, unknown> = {
    hat: {
      opcode: "event_whenflagclicked",
      next: "clone1",
      parent: null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: true,
      x: 0,
      y: 0,
    },
    clone1: {
      opcode: "control_create_clone_of",
      next: "moveOrig",
      parent: "hat",
      inputs: {
        CLONE_OPTION: [1, [4, "_myself_"]],
      },
      fields: {},
      shadow: false,
      topLevel: false,
    },
    moveOrig: {
      opcode: "motion_movesteps",
      next: "clone2",
      parent: "clone1",
      inputs: {STEPS: [1, [4, "10"]]},
      fields: {},
      shadow: false,
      topLevel: false,
    },
    clone2: {
      opcode: "control_create_clone_of",
      next: "wait1",
      parent: "moveOrig",
      inputs: {
        CLONE_OPTION: [1, [4, "_myself_"]],
      },
      fields: {},
      shadow: false,
      topLevel: false,
    },
    wait1: {
      opcode: "control_wait",
      next: null,
      parent: "clone2",
      inputs: {DURATION: [1, [4, "0.01"]]},
      fields: {},
      shadow: false,
      topLevel: false,
    },
    cloneHat: {
      opcode: "control_start_as_clone",
      next: "cloneMove",
      parent: null,
      inputs: {},
      fields: {},
      shadow: false,
      topLevel: true,
      x: 0,
      y: 120,
    },
    cloneMove: {
      opcode: "motion_movesteps",
      next: "cloneWait",
      parent: "cloneHat",
      inputs: {STEPS: [1, [4, String(cloneMoves[0] ?? 5)]]},
      fields: {},
      shadow: false,
      topLevel: false,
    },
    cloneWait: {
      opcode: "control_wait",
      next: "cloneMove2",
      parent: "cloneMove",
      inputs: {DURATION: [1, [4, "0.01"]]},
      fields: {},
      shadow: false,
      topLevel: false,
    },
    cloneMove2: {
      opcode: "motion_movesteps",
      next: null,
      parent: "cloneWait",
      inputs: {STEPS: [1, [4, String(cloneMoves[1] ?? 8)]]},
      fields: {},
      shadow: false,
      topLevel: false,
    },
  };
  sprite.blocks = blocks;
}

function findSpriteTarget(
  runtime: ScratchVmInstance["runtime"],
): Record<string, unknown> & {x?: number; y?: number; id?: string; getName?: () => string; isOriginal?: boolean} {
  const sprite = runtime.targets.find(
    target => (target as {isStage?: boolean}).isStage === false,
  );
  if (!sprite) throw new Error("Sprite target missing");
  return sprite as Record<string, unknown> & {
    x?: number;
    y?: number;
    id?: string;
    getName?: () => string;
    isOriginal?: boolean;
  };
}

export type RewindVmHarness = {
  vm: ScratchVmInstance;
  sprite: Record<string, unknown> & {x?: number; y?: number; id?: string};
  findSprite(): RewindVmHarness["sprite"];
  rewind: ExecutionRewindHandle;
  journal: RewindJournal;
  originDocument: ProjectDocument;
  control: ReturnType<typeof installExecutionControl>;
  trace: ReturnType<typeof installExecutionTrace>;
  stepRecordedFrames(count: number): void;
  restoreOrigin(origin: RewindOrigin): Promise<void>;
};

export async function createRewindVmHarness(
  options: MoveScriptOptions & {
    clones?: boolean;
    cloneMoves?: number[];
    forever?: boolean;
    foreverStep?: number;
    foreverBounce?: boolean;
    foreverBounceStep?: number;
  } = {},
): Promise<RewindVmHarness> {
  const VirtualMachine = loadScratchVm();
  const vm = new VirtualMachine();
  vm.start();

  const project = readCatProjectJson();
  if (options.clones) {
    attachCloneScript(project, {cloneMoves: options.cloneMoves});
  } else if (options.foreverBounce) {
    attachForeverMoveBounceScript(project, options.foreverBounceStep ?? 10);
  } else if (options.forever) {
    attachForeverMoveScript(project, options.foreverStep ?? 1);
  } else {
    attachMoveScript(project, options);
  }
  await vm.loadProject(structuredClone(project));

  const sprite = findSpriteTarget(vm.runtime);

  const originDocument = projectJsonToDocument(project, new Map());
  const journal = new RewindJournal();

  const trace = installExecutionTrace({runtime: vm.runtime})!;
  const rewind = installExecutionRewind(
    {runtime: vm.runtime},
    {
      journal,
      captureOrigin: () => {
        const vmProjectJson = JSON.parse(vm.toJSON()) as Record<string, unknown>;
        return createRewindOrigin({
          document: projectJsonToDocument(vmProjectJson, new Map()),
          assets: new Map(),
          projectSessionId: 1,
          runtime: vm.runtime as import("./execution-rewind-fingerprint.js").RewindRuntimeLike,
          vmProjectJson,
        });
      },
      restoreOrigin: async origin => {
        await vm.loadProject(
          structuredClone(origin.vmProjectJson ?? documentToVmJson(origin.document)),
        );
      },
    },
  )!;
  const control = installExecutionControl({runtime: vm.runtime})!;

  return {
    vm,
    sprite,
    findSprite: () => findSpriteTarget(vm.runtime),
    rewind,
    journal,
    originDocument,
    control,
    trace,
    stepRecordedFrames(count: number) {
      vm.greenFlag();
      for (let i = 0; i < count; i += 1) {
        vm.runtime._step?.();
      }
    },
    async restoreOrigin(origin: RewindOrigin) {
      await vm.loadProject(
        structuredClone(origin.vmProjectJson ?? documentToVmJson(origin.document)),
      );
      restartGreenFlagHatThreads(vm.runtime);
    },
  };
}

function documentToVmJson(document: ProjectDocument): Record<string, unknown> {
  return {
    targets: document.targets.map(target => ({
      ...target,
      blocks: Object.fromEntries(
        Object.entries(target.blocks ?? {}).map(([id, block]) => [
          id,
          Array.isArray(block) ? block : {...block, id},
        ]),
      ),
    })),
    monitors: document.monitors ?? [],
    extensions: document.extensions ?? [],
    meta: document.meta ?? {semver: "3.0.0", vm: "14.1.0", agent: "rewind-test"},
  };
}

export {
  attachCloneScript,
  attachForeverMoveScript,
  attachMoveScript,
  documentToVmJson,
  findSpriteTarget,
  readCatProjectJson,
};
