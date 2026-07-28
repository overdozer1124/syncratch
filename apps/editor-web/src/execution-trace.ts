/**
 * Records what the VM actually executed with semantic snapshots captured at
 * primitive boundaries (evaluated args, before/after state, control flow).
 */

import {
  installPrimitiveTraceCapture,
  recordHatBlockStart,
} from "./execution-trace-capture.js";
import type {TraceEntry, TraceSemanticSnapshot} from "./execution-trace-types.js";

const TRACE_FLAG = "_syncratchExecutionTraceInstalled";
const THREAD_FLAG = "__syncratchTraced";
const HAT_FLAG = "__syncratchHatRecorded";
const DEFAULT_LIMIT = 500;

export type {TraceEntry, TraceSemanticSnapshot};

export interface ExecutionTrace {
  record(entry: Omit<TraceEntry, "time"> & {time?: number}): void;
  /** Oldest first. */
  getEntries(): TraceEntry[];
  /** Entries visible at the current playback cursor. */
  getDisplayEntries(): TraceEntry[];
  clear(): void;
  /** Drop newest entries so {@link size} is at most `maxSize`. */
  truncateTo(maxSize: number): void;
  size(): number;
  setRecordingSuspended(suspended: boolean): void;
  isRecordingSuspended(): boolean;
  setDisplayCursor(maxSize: number): void;
  getDisplayCursor(): number;
}

export interface ExecutionTraceOptions {
  limit?: number;
  now?: () => number;
}

function cloneSnapshot(snapshot: TraceSemanticSnapshot): TraceSemanticSnapshot {
  return structuredClone(snapshot);
}

export function createExecutionTrace(
  options: ExecutionTraceOptions = {},
): ExecutionTrace {
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const now = options.now ?? (() => Date.now());
  let entries: TraceEntry[] = [];
  let recordingSuspended = false;
  let displayCursor = 0;

  const clampDisplayCursor = () => {
    displayCursor = Math.max(0, Math.min(displayCursor, entries.length));
  };

  return {
    record(entry) {
      if (recordingSuspended) return;
      if (typeof entry.blockId !== "string" || !entry.blockId) return;
      const at = typeof entry.time === "number" ? entry.time : now();
      entries.push({
        blockId: entry.blockId,
        targetId: entry.targetId,
        targetName: entry.targetName,
        time: at,
        snapshot: cloneSnapshot(entry.snapshot),
      });
      if (entries.length > limit) {
        entries = entries.slice(entries.length - limit);
      }
      if (displayCursor >= entries.length - 1) {
        displayCursor = entries.length;
      }
      clampDisplayCursor();
    },
    getEntries: () =>
      entries.map(entry => ({
        ...entry,
        snapshot: cloneSnapshot(entry.snapshot),
      })),
    getDisplayEntries() {
      clampDisplayCursor();
      return entries.slice(0, displayCursor).map(entry => ({
        ...entry,
        snapshot: cloneSnapshot(entry.snapshot),
      }));
    },
    clear() {
      entries = [];
      displayCursor = 0;
    },
    truncateTo(maxSize: number) {
      const limitSize = Math.max(0, Math.floor(maxSize));
      if (entries.length > limitSize) {
        entries = entries.slice(0, limitSize);
      }
      displayCursor = Math.min(displayCursor, entries.length);
    },
    size: () => entries.length,
    setRecordingSuspended(suspended: boolean) {
      recordingSuspended = suspended;
    },
    isRecordingSuspended: () => recordingSuspended,
    setDisplayCursor(maxSize: number) {
      displayCursor = Math.max(0, Math.floor(maxSize));
      clampDisplayCursor();
    },
    getDisplayCursor: () => {
      clampDisplayCursor();
      return displayCursor;
    },
  };
}

export type TraceThreadLike = {
  blockGlowInFrame?: string | null;
  topBlock?: string | null;
  target?: {
    id?: string;
    getName?: () => string;
    blocks?: {getBlock?: (id: string) => {opcode?: string} | null};
  } | null;
  updateMonitor?: boolean;
  [THREAD_FLAG]?: boolean;
  [HAT_FLAG]?: boolean;
};

export type TraceRuntimeLike = {
  threads?: TraceThreadLike[];
  _step?: (...args: unknown[]) => unknown;
  getOpcodeFunction?: (opcode: string) => unknown;
  getBlocksJSON?: () => Array<{
    type?: string;
    message0?: string;
    message1?: string;
    message2?: string;
  }>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  off?: (event: string, handler: (...args: unknown[]) => void) => void;
  [TRACE_FLAG]?: boolean;
};

export type TraceVmLike = {
  runtime?: unknown;
};

/**
 * Mark threads so hat blocks are recorded once per script run.
 * Command blocks are recorded via the primitive wrapper instead of
 * blockGlowInFrame to avoid duplicate entries.
 */
export function instrumentThread(
  thread: TraceThreadLike,
  trace: ExecutionTrace,
): boolean {
  if (!thread || thread[THREAD_FLAG] || thread.updateMonitor) return false;

  if (!thread[HAT_FLAG] && typeof thread.topBlock === "string" && thread.topBlock) {
    recordHatBlockStart(trace, thread);
    thread[HAT_FLAG] = true;
  }

  thread[THREAD_FLAG] = true;
  return true;
}

export interface ExecutionTraceHandle {
  trace: ExecutionTrace;
  dispose(): void;
}

export function installExecutionTrace(
  vm: TraceVmLike,
  options: ExecutionTraceOptions & {trace?: ExecutionTrace} = {},
): ExecutionTraceHandle | null {
  const runtime =
    vm.runtime && typeof vm.runtime === "object"
      ? (vm.runtime as TraceRuntimeLike)
      : null;
  if (!runtime || typeof runtime._step !== "function") return null;

  const trace = options.trace ?? createExecutionTrace(options);
  const rawStep = runtime._step;
  const originalStep = rawStep.bind(runtime);
  let disposed = false;

  const disposePrimitiveCapture = installPrimitiveTraceCapture(runtime, trace);

  const instrumentAll = () => {
    if (trace.isRecordingSuspended()) return;
    const threads = runtime.threads;
    if (!Array.isArray(threads)) return;
    for (const thread of threads) {
      instrumentThread(thread, trace);
    }
  };

  const onProjectStart = () => {
    trace.clear();
    const threads = runtime.threads;
    if (Array.isArray(threads)) {
      for (const thread of threads) {
        delete thread[HAT_FLAG];
      }
    }
  };
  runtime.on?.("PROJECT_START", onProjectStart);

  runtime._step = (...args: unknown[]) => {
    if (!disposed) instrumentAll();
    return originalStep(...args);
  };
  runtime[TRACE_FLAG] = true;

  return {
    trace,
    dispose() {
      if (disposed) return;
      disposed = true;
      runtime.off?.("PROJECT_START", onProjectStart);
      runtime._step = rawStep;
      runtime[TRACE_FLAG] = false;
      disposePrimitiveCapture();
    },
  };
}

/** @deprecated Entries now carry frozen snapshot labels; resolves live target names only when missing. */
export interface ResolvedTraceEntry extends TraceEntry {}

export type TraceResolveTarget = {
  id?: string;
  getName?: () => string;
};

export function resolveTraceEntries(
  entries: TraceEntry[],
  targets: TraceResolveTarget[] | null | undefined,
): ResolvedTraceEntry[] {
  const byId = new Map<string, TraceResolveTarget>();
  for (const target of targets ?? []) {
    if (target?.id) byId.set(target.id, target);
  }
  return entries.map(entry => {
    if (entry.targetName) return {...entry};
    const target = entry.targetId ? byId.get(entry.targetId) : undefined;
    let targetName: string | null = null;
    try {
      targetName = target?.getName?.() ?? null;
    } catch {
      targetName = null;
    }
    return {...entry, targetName};
  });
}
