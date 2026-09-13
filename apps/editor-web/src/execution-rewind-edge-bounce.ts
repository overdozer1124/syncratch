import type {JournalEntry} from "./execution-rewind-types.js";
import type {RewindJournal} from "./execution-rewind-journal.js";
import {RewindJournalMismatchError} from "./execution-rewind-journal.js";

type EdgeBounceJournalEntry = Extract<JournalEntry, {kind: "edgeBounce"}>;

type EdgeBounceTargetLike = {
  direction?: number;
  x?: number;
  y?: number;
  setDirection?: (direction: number) => void;
  setXY?: (x: number, y: number) => void;
};

export type EdgeBounceRuntimeLike = {
  getOpcodeFunction?: (opcode: string) => unknown;
  __syncratchRewindOriginalGetOpcodeFunction?: (opcode: string) => unknown;
};

const EDGE_BOUNCE_OPCODE = "motion_ifonedgebounce";
const EDGE_BOUNCE_FLAG = "__syncratchRewindEdgeBounceInstalled";

function readTargetState(target: EdgeBounceTargetLike): {
  direction: number;
  x: number;
  y: number;
} {
  return {
    direction: target.direction ?? 90,
    x: target.x ?? 0,
    y: target.y ?? 0,
  };
}

function applyEdgeBounceEntry(
  target: EdgeBounceTargetLike,
  entry: EdgeBounceJournalEntry,
): void {
  if (!entry.applied) return;
  target.setDirection?.(entry.direction);
  target.setXY?.(entry.x, entry.y);
}

/**
 * Journal `motion_ifonedgebounce` outcomes so replay does not depend on renderer
 * bounds being available after `loadProject()`.
 */
export function installEdgeBounceCapture(input: {
  runtime: EdgeBounceRuntimeLike;
  journal: RewindJournal;
}): () => void {
  const {runtime, journal} = input;
  if ((runtime as Record<string, unknown>)[EDGE_BOUNCE_FLAG]) {
    return () => undefined;
  }

  const originalGetOpcodeFunction = runtime.getOpcodeFunction?.bind(runtime);
  if (!originalGetOpcodeFunction) {
    return () => undefined;
  }

  runtime.__syncratchRewindOriginalGetOpcodeFunction = originalGetOpcodeFunction;

  runtime.getOpcodeFunction = (opcode: string) => {
    const original = originalGetOpcodeFunction(opcode);
    if (opcode !== EDGE_BOUNCE_OPCODE || typeof original !== "function") {
      return original;
    }

    return (args: unknown, util: {target?: EdgeBounceTargetLike}) => {
      const target = util.target;
      if (!target) {
        return (original as (...params: unknown[]) => unknown)(args, util);
      }

      const mode = journal.getMode();
      if (mode === "replay") {
        const entry = journal.consume("edgeBounce");
        if (!entry || entry.kind !== "edgeBounce") {
          throw new RewindJournalMismatchError(
            "Expected edgeBounce journal entry",
          );
        }
        applyEdgeBounceEntry(target, entry);
        return;
      }

      const before = readTargetState(target);
      const result = (original as (...params: unknown[]) => unknown)(args, util);
      if (mode === "record") {
        const after = readTargetState(target);
        journal.append({
          kind: "edgeBounce",
          applied:
            after.direction !== before.direction ||
            after.x !== before.x ||
            after.y !== before.y,
          direction: after.direction,
          x: after.x,
          y: after.y,
        });
      }
      return result;
    };
  };

  (runtime as Record<string, unknown>)[EDGE_BOUNCE_FLAG] = true;

  return () => {
    if (runtime.__syncratchRewindOriginalGetOpcodeFunction) {
      runtime.getOpcodeFunction =
        runtime.__syncratchRewindOriginalGetOpcodeFunction;
      delete runtime.__syncratchRewindOriginalGetOpcodeFunction;
    }
    (runtime as Record<string, unknown>)[EDGE_BOUNCE_FLAG] = false;
  };
}
