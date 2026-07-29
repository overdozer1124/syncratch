import {
  createTraceDescriptorContext,
  getTraceDescriptor,
  indexBlockTemplates,
  lookupBlockTemplate,
} from "./execution-trace-format.js";
import type {
  TraceBlockLike,
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

/** Read a Scratch field (runtime `{value}` or sb3 `[value, id]`). */
export function readTraceFieldValue(field: unknown): unknown {
  if (field === null || field === undefined) return undefined;
  if (
    typeof field === "string" ||
    typeof field === "number" ||
    typeof field === "boolean"
  ) {
    return field;
  }
  if (Array.isArray(field)) {
    return field.length > 0 ? field[0] : undefined;
  }
  if (typeof field === "object") {
    const record = field as {value?: unknown};
    if ("value" in record) return record.value;
  }
  return undefined;
}

/** sb3 input: `[shadowType, literal|[type, value]|blockId]` (+ optional shadow). */
function readSb3InputLiteral(entry: unknown): unknown {
  if (!Array.isArray(entry) || entry.length < 2) return undefined;
  const primary = entry[1];
  if (Array.isArray(primary) && primary.length >= 2) {
    return primary[1];
  }
  if (entry.length >= 3 && Array.isArray(entry[2]) && entry[2].length >= 2) {
    // Obscured shadow still carries the dropdown/number default.
    return entry[2][1];
  }
  return undefined;
}

const SHADOW_LITERAL_FIELD_KEYS = ["NUM", "TEXT", "COLOUR", "VALUE"] as const;

function readLeafBlockLiteral(block: TraceBlockLike | null | undefined): unknown {
  if (!block?.fields) return undefined;
  for (const key of SHADOW_LITERAL_FIELD_KEYS) {
    if (key in block.fields) {
      const value = readTraceFieldValue(block.fields[key]);
      if (value !== undefined) return value;
    }
  }
  const values = Object.values(block.fields);
  if (values.length === 1) return readTraceFieldValue(values[0]);
  return undefined;
}

function readRuntimeInputLiteral(
  entry: unknown,
  getBlock: (id: string) => TraceBlockLike | null | undefined,
): unknown {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
  const record = entry as {block?: string | null; shadow?: string | null};
  const blockId =
    typeof record.block === "string" && record.block
      ? record.block
      : typeof record.shadow === "string" && record.shadow
        ? record.shadow
        : null;
  if (!blockId) return undefined;
  return readLeafBlockLiteral(getBlock(blockId));
}

/**
 * Collect hat/menu fields and shadow literals for history display.
 * Stack commands normally get evaluated args from the VM primitive wrapper;
 * hats are recorded separately and need this extraction.
 */
export function extractBlockSnapshotArgs(
  block: TraceBlockLike | null | undefined,
  getBlock?: (id: string) => TraceBlockLike | null | undefined,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (!block) return args;

  for (const [key, field] of Object.entries(block.fields ?? {})) {
    const value = readTraceFieldValue(field);
    if (value !== undefined) args[key] = value;
  }

  for (const [key, input] of Object.entries(block.inputs ?? {})) {
    if (key in args) continue;
    let value: unknown;
    if (Array.isArray(input)) {
      value = readSb3InputLiteral(input);
    } else if (getBlock) {
      value = readRuntimeInputLiteral(input, getBlock);
    }
    if (value !== undefined) args[key] = value;
  }

  return args;
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
  const getBlock = target?.blocks?.getBlock?.bind(target.blocks);
  const block = getBlock?.(blockId) ?? null;
  const opcode = block?.opcode ?? "event_whenflagclicked";
  const rawArgs = extractBlockSnapshotArgs(block, getBlock);
  recorder.record({
    blockId,
    targetId: target?.id ?? null,
    targetName: readTargetName(target),
    snapshot: {
      opcode,
      displayTemplate: lookupBlockTemplate(opcode),
      args: serializeTraceArgs(rawArgs),
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
