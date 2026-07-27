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

function loadScratchVm(): new () => ScratchVmInstance {
  return require(SCRATCH_VM_PATH) as new () => ScratchVmInstance;
}

function readCatProjectJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(CAT_PROJECT_PATH, "utf8")) as Record<
    string,
    unknown
  >;
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

export type RewindVmHarness = {
  vm: ScratchVmInstance;
  sprite: Record<string, unknown> & {x?: number; y?: number; id?: string};
  rewind: ExecutionRewindHandle;
  journal: RewindJournal;
  originDocument: ProjectDocument;
  control: ReturnType<typeof installExecutionControl>;
  trace: ReturnType<typeof installExecutionTrace>;
  stepRecordedFrames(count: number): void;
  restoreOrigin(origin: RewindOrigin): Promise<void>;
};

export async function createRewindVmHarness(
  options: MoveScriptOptions = {},
): Promise<RewindVmHarness> {
  const VirtualMachine = loadScratchVm();
  const vm = new VirtualMachine();
  vm.start();

  const project = readCatProjectJson();
  attachMoveScript(project, options);
  await vm.loadProject(structuredClone(project));

  const sprite = vm.runtime.targets.find(
    target => (target as {isStage?: boolean}).isStage === false,
  ) as RewindVmHarness["sprite"];
  if (!sprite) throw new Error("Sprite missing after loadProject");

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
          runtime: vm.runtime,
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

export {attachMoveScript, documentToVmJson, readCatProjectJson};
