import {
  createTraceDescriptorContext,
  getTraceDescriptor,
  indexBlockTemplates,
  lookupBlockTemplate,
} from "./execution-trace-format.js";
import type {
  TraceBlockUtilLike,
  TraceEntry,
  TraceSemanticSnapshot,
  TraceTargetLike,
} from "./execution-trace-types.js";
import {argsSignature, serializeTraceArgs, serializeTraceValue} from "./execution-trace-values.js";

export type PrimitiveCaptureRuntimeLike = {
  getOpcodeFunction?: (opcode: string) => unknown;
  getBlocksJSON?: () => Array<{
    type?: string;
    message0?: string;
    message1?: string;
    message2?: string;
  }>;
};

export type SemanticTraceRecorder = {
  record(entry: Omit<TraceEntry, "time"> & {time?: number}): void;
};

const PRIMITIVE_WRAP_FLAG = "__syncratchTracePrimitiveWrap";

function isPromise(value: unknown): value is Promise<unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Promise<unknown>).then === "function"
  );
}

function readTargetName(target: TraceTargetLike | null | undefined): string | null {
  try {
    return target?.getName?.() ?? null;
  } catch {
    return null;
  }
}

function shouldRecordCommand(opcode: string, util: TraceBlockUtilLike): boolean {
  const blockId = util.thread?.peekStack?.();
  if (!blockId) return false;
  const target = util.target ?? util.thread?.target ?? null;
  const block = target?.blocks?.getBlock?.(blockId);
  if (!block?.opcode) return false;
  return block.opcode === opcode;
}

function buildSnapshot(
  opcode: string,
  args: Record<string, unknown>,
  util: TraceBlockUtilLike,
  result: unknown,
  ctx = createTraceDescriptorContext(),
): TraceSemanticSnapshot {
  const descriptor = getTraceDescriptor(opcode);
  const serializedArgs = serializeTraceArgs(args);
  const before = descriptor?.captureBefore?.(args, util, ctx);
  const after = descriptor?.captureAfter?.(args, util, before, result, ctx);
  const control = descriptor?.enrichControl?.(args, util, before, ctx);
  const snapshot: TraceSemanticSnapshot = {
    opcode,
    displayTemplate: lookupBlockTemplate(opcode),
    args: serializedArgs,
    before,
    after,
    control,
  };
  if (result !== undefined) {
    snapshot.result = serializeTraceValue(result);
  }
  return snapshot;
}

function wrapPrimitiveFunction(
  opcode: string,
  original: (...args: unknown[]) => unknown,
  recorder: SemanticTraceRecorder,
): (...args: unknown[]) => unknown {
  const ctx = createTraceDescriptorContext();
  return ((...params: unknown[]) => {
    const args = params[0] as Record<string, unknown>;
    const util = params[1] as TraceBlockUtilLike;
    const recordCommand = shouldRecordCommand(opcode, util);
    const blockId = util.thread?.peekStack?.() ?? "";
    const target = util.target ?? util.thread?.target ?? null;
    const targetId = target?.id ?? null;
    const targetName = readTargetName(target);
    const descriptor = getTraceDescriptor(opcode);

    if (!recordCommand) {
      return original.call(null, args, util);
    }

    const before = descriptor?.captureBefore?.(args, util, ctx);

    try {
      const result = original.call(null, args, util);

      const finalize = (resolved: unknown) => {
        const after = descriptor?.captureAfter?.(args, util, before, resolved, ctx);
        const control = descriptor?.enrichControl?.(args, util, before, ctx);
        const snapshot: TraceSemanticSnapshot = {
          opcode,
          displayTemplate: lookupBlockTemplate(opcode),
          args: serializeTraceArgs(args),
          before,
          after,
          control,
        };
        if (resolved !== undefined) {
          snapshot.result = serializeTraceValue(resolved);
        }
        recorder.record({
          blockId,
          targetId,
          targetName,
          snapshot,
        });
        return resolved;
      };

      if (isPromise(result)) {
        return result.then(
          resolved => finalize(resolved),
          error => Promise.reject(error),
        );
      }
      return finalize(result);
    } catch (error) {
      throw error;
    }
  }) as (...args: unknown[]) => unknown;
}

export function recordHatBlockStart(
  recorder: SemanticTraceRecorder,
  thread: {
    topBlock?: string | null;
    target?: TraceTargetLike | null;
  },
): void {
  const blockId = thread.topBlock;
  if (typeof blockId !== "string" || !blockId) return;
  const target = thread.target ?? null;
  const block = target?.blocks?.getBlock?.(blockId);
  const opcode = block?.opcode ?? "event_whenflagclicked";
  recorder.record({
    blockId,
    targetId: target?.id ?? null,
    targetName: readTargetName(target),
    snapshot: {
      opcode,
      displayTemplate: lookupBlockTemplate(opcode),
      args: {},
      control: {firstVisit: true},
    },
  });
}

export function installPrimitiveTraceCapture(
  runtime: PrimitiveCaptureRuntimeLike,
  recorder: SemanticTraceRecorder,
): () => void {
  if ((runtime as Record<string, unknown>)[PRIMITIVE_WRAP_FLAG]) {
    return () => undefined;
  }

  indexBlockTemplates(runtime.getBlocksJSON?.());

  const originalGetOpcodeFunction = runtime.getOpcodeFunction?.bind(runtime);
  if (!originalGetOpcodeFunction) return () => undefined;

  const wrappedByOpcode = new Map<string, (...args: unknown[]) => unknown>();

  runtime.getOpcodeFunction = (opcode: string) => {
    const original = originalGetOpcodeFunction(opcode);
    if (typeof original !== "function") return original;
    let wrapped = wrappedByOpcode.get(opcode);
    if (!wrapped) {
      wrapped = wrapPrimitiveFunction(opcode, original as (...args: unknown[]) => unknown, recorder);
      wrappedByOpcode.set(opcode, wrapped);
    }
    return wrapped;
  };

  (runtime as Record<string, unknown>)[PRIMITIVE_WRAP_FLAG] = true;

  return () => {
    runtime.getOpcodeFunction = originalGetOpcodeFunction;
    wrappedByOpcode.clear();
    (runtime as Record<string, unknown>)[PRIMITIVE_WRAP_FLAG] = false;
  };
}

export function entriesWouldCoalesce(
  previous: TraceEntry | undefined,
  next: Omit<TraceEntry, "time">,
): boolean {
  if (!previous) return false;
  if (previous.blockId !== next.blockId || previous.targetId !== next.targetId) {
    return false;
  }
  if (previous.snapshot.opcode !== next.snapshot.opcode) return false;
  if (argsSignature(previous.snapshot.args) !== argsSignature(next.snapshot.args)) {
    return false;
  }
  const prevResult = JSON.stringify(previous.snapshot.result ?? null);
  const nextResult = JSON.stringify(
    "result" in next.snapshot ? next.snapshot.result ?? null : null,
  );
  return prevResult === nextResult;
}

export {buildSnapshot, shouldRecordCommand, wrapPrimitiveFunction};
