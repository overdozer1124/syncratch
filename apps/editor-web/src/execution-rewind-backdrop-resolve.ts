import type {JournalEntry} from "./execution-rewind-types.js";
import type {RewindJournal} from "./execution-rewind-journal.js";
import {RewindJournalMismatchError} from "./execution-rewind-journal.js";

const RANDOM_BACKDROP_REQUEST = "random backdrop";

const BACKDROP_RESOLVE_OPCODES = new Set([
  "looks_switchbackdrop",
  "looks_switchbackdroptoandwait",
]);

const BACKDROP_WRAP_FLAG = "__syncratchRewindBackdropWrap";

type BackdropResolveJournalEntry = Extract<
  JournalEntry,
  {kind: "backdropResolve"}
>;

type BackdropRuntimeLike = {
  getTargetForStage?: () => BackdropStageLike | null;
};

type BackdropStageLike = {
  currentCostume?: number;
  getCostumes?: () => Array<{name?: string}>;
};

export type BackdropCaptureRuntimeLike = {
  getOpcodeFunction?: (opcode: string) => unknown;
  getTargetForStage?: BackdropRuntimeLike["getTargetForStage"];
};

function isRandomBackdropRequest(args: unknown): boolean {
  if (!args || typeof args !== "object") return false;
  const backdrop = (args as {BACKDROP?: unknown}).BACKDROP;
  return (
    typeof backdrop === "string" &&
    backdrop.toLowerCase() === RANDOM_BACKDROP_REQUEST
  );
}

function readStageBackdrop(
  runtime: BackdropCaptureRuntimeLike,
): {backdropName: string; costumeIndex: number} {
  const stage = runtime.getTargetForStage?.();
  const costumeIndex = stage?.currentCostume ?? 0;
  const costumes = stage?.getCostumes?.() ?? [];
  const backdropName = costumes[costumeIndex]?.name ?? "";
  return {backdropName, costumeIndex};
}

function withResolvedBackdropArgs(
  args: unknown,
  backdropName: string,
): unknown {
  if (!args || typeof args !== "object") {
    return {BACKDROP: backdropName};
  }
  return {...args, BACKDROP: backdropName};
}

function wrapBackdropResolveOpcode(
  opcode: string,
  original: (...args: unknown[]) => unknown,
  runtime: BackdropCaptureRuntimeLike,
  journal: RewindJournal,
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => {
    const request = args[0];
    if (!isRandomBackdropRequest(request)) {
      return original(...args);
    }

    const mode = journal.getMode();
    if (mode === "replay") {
      const entry = journal.consume("backdropResolve") as
        | BackdropResolveJournalEntry
        | null;
      if (!entry || entry.kind !== "backdropResolve") {
        throw new RewindJournalMismatchError(
          "Expected backdropResolve journal entry",
        );
      }
      return original(withResolvedBackdropArgs(request, entry.backdropName), args[1]);
    }

    const result = original(...args);
    if (mode === "record") {
      const {backdropName, costumeIndex} = readStageBackdrop(runtime);
      journal.append({
        kind: "backdropResolve",
        requested: RANDOM_BACKDROP_REQUEST,
        backdropName,
        costumeIndex,
      });
    }
    return result;
  };
}

export function installBackdropResolveCapture(input: {
  runtime: BackdropCaptureRuntimeLike;
  journal: RewindJournal;
}): () => void {
  const {runtime, journal} = input;
  if ((runtime as Record<string, unknown>)[BACKDROP_WRAP_FLAG]) {
    return () => undefined;
  }

  const originalGetOpcodeFunction = runtime.getOpcodeFunction?.bind(runtime);
  const wrappedByOpcode = new Map<string, (...args: unknown[]) => unknown>();
  if (!originalGetOpcodeFunction) {
    return () => undefined;
  }

  runtime.getOpcodeFunction = (opcode: string) => {
    const original = originalGetOpcodeFunction(opcode);
    if (typeof original !== "function") return original;
    if (!BACKDROP_RESOLVE_OPCODES.has(opcode)) {
      return original;
    }

    let wrapped = wrappedByOpcode.get(opcode);
    if (!wrapped) {
      wrapped = wrapBackdropResolveOpcode(
        opcode,
        original as (...args: unknown[]) => unknown,
        runtime,
        journal,
      );
      wrappedByOpcode.set(opcode, wrapped);
    }
    return wrapped;
  };

  (runtime as Record<string, unknown>)[BACKDROP_WRAP_FLAG] = true;

  return () => {
    runtime.getOpcodeFunction = originalGetOpcodeFunction;
    wrappedByOpcode.clear();
    (runtime as Record<string, unknown>)[BACKDROP_WRAP_FLAG] = false;
  };
}
