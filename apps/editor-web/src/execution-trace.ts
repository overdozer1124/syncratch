/**
 * Records which blocks the VM actually executed, so learners (and the AI) can
 * look at what happened instead of guessing from the static project.
 *
 * How the events are captured: `Sequencer.stepThread` assigns
 * `thread.blockGlowInFrame = currentBlockId` immediately after running each
 * block. Redefining that property on each live thread turns those assignments
 * into a complete, per-block trace — reading `blockGlowInFrame` once per frame
 * would only sample the last block of each frame and miss everything a loop did
 * in between. `vendor/scratch-editor` is a pinned submodule (ADR-0001), so this
 * stays on the app side.
 *
 * Hot path discipline: a tight `forever` loop runs thousands of blocks a
 * second, so recording stores ids only — no block lookups, no string building.
 * Opcodes and sprite names are resolved later, when something actually renders
 * the trace. Consecutive runs of the same block are coalesced into one entry
 * with a count, otherwise a single loop would flush the whole buffer.
 */

const TRACE_FLAG = "_syncratchExecutionTraceInstalled";
const THREAD_FLAG = "__syncratchTraced";
const DEFAULT_LIMIT = 500;

export interface TraceEntry {
  blockId: string;
  targetId: string | null;
  /** Timestamp of the first execution in this run. */
  firstTime: number;
  /** Timestamp of the most recent execution in this run. */
  lastTime: number;
  /** Consecutive executions coalesced into this entry. */
  count: number;
}

export interface ExecutionTrace {
  record(blockId: string, targetId: string | null, time?: number): void;
  /** Oldest first. */
  getEntries(): TraceEntry[];
  clear(): void;
  size(): number;
}

export interface ExecutionTraceOptions {
  /** Maximum coalesced entries kept. Oldest are dropped first. */
  limit?: number;
  now?: () => number;
}

export function createExecutionTrace(
  options: ExecutionTraceOptions = {},
): ExecutionTrace {
  const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT);
  const now = options.now ?? (() => Date.now());
  let entries: TraceEntry[] = [];

  return {
    record(blockId, targetId, time) {
      if (typeof blockId !== "string" || !blockId) return;
      const at = typeof time === "number" ? time : now();
      const last = entries[entries.length - 1];
      if (last && last.blockId === blockId && last.targetId === targetId) {
        last.count += 1;
        last.lastTime = at;
        return;
      }
      entries.push({
        blockId,
        targetId,
        firstTime: at,
        lastTime: at,
        count: 1,
      });
      if (entries.length > limit) {
        entries = entries.slice(entries.length - limit);
      }
    },
    getEntries: () => entries.map(entry => ({...entry})),
    clear() {
      entries = [];
    },
    size: () => entries.length,
  };
}

export type TraceThreadLike = {
  blockGlowInFrame?: string | null;
  /** Hat (or top) block the script was started from. */
  topBlock?: string | null;
  target?: {id?: string} | null;
  updateMonitor?: boolean;
  [THREAD_FLAG]?: boolean;
};

export type TraceRuntimeLike = {
  threads?: TraceThreadLike[];
  _step?: (...args: unknown[]) => unknown;
  [TRACE_FLAG]?: boolean;
};

export type TraceVmLike = {
  runtime?: unknown;
};

/**
 * Redefine `blockGlowInFrame` on one thread so writes are also recorded.
 * Idempotent, and leaves monitor threads alone — those re-run every frame and
 * would drown out the project's own execution.
 */
export function instrumentThread(
  thread: TraceThreadLike,
  trace: ExecutionTrace,
): boolean {
  if (!thread || thread[THREAD_FLAG] || thread.updateMonitor) return false;

  // The sequencer never "runs" a hat block — it is where the thread starts, so
  // it never lands in blockGlowInFrame. Record it here, otherwise the timeline
  // cannot answer "did my green-flag script start at all?".
  if (typeof thread.topBlock === "string" && thread.topBlock) {
    trace.record(thread.topBlock, thread.target?.id ?? null);
  }

  let value: string | null | undefined = thread.blockGlowInFrame;
  try {
    Object.defineProperty(thread, "blockGlowInFrame", {
      configurable: true,
      enumerable: true,
      get: () => value,
      set: (next: string | null) => {
        value = next;
        if (typeof next === "string" && next) {
          trace.record(next, thread.target?.id ?? null);
        }
      },
    });
  } catch {
    // Sealed or non-configurable thread: skip rather than break execution.
    return false;
  }
  thread[THREAD_FLAG] = true;
  return true;
}

export interface ExecutionTraceHandle {
  trace: ExecutionTrace;
  dispose(): void;
}

/**
 * Start tracing `vm`. Threads are (re)instrumented at the start of every frame,
 * because scratch-vm creates a fresh Thread for each script run.
 *
 * Wraps `_step` independently of installExecutionControl: order does not
 * matter, since instrumenting threads while execution is paused is a no-op.
 */
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

  const instrumentAll = () => {
    const threads = runtime.threads;
    if (!Array.isArray(threads)) return;
    for (const thread of threads) {
      instrumentThread(thread, trace);
    }
  };

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
      runtime._step = rawStep;
      runtime[TRACE_FLAG] = false;
    },
  };
}

export interface ResolvedTraceEntry extends TraceEntry {
  /** Block opcode, or null when the block no longer exists. */
  opcode: string | null;
  /** Sprite / stage name, or null when the target is gone. */
  targetName: string | null;
}

export type TraceResolveTarget = {
  id?: string;
  getName?: () => string;
  blocks?: {getBlock?: (id: string) => {opcode?: string} | null | undefined};
};

/**
 * Attach opcodes and sprite names for display. Entries whose block or target
 * has since been deleted keep their ids and report nulls rather than vanishing —
 * "this ran, then you deleted it" is useful information when debugging.
 */
export function resolveTraceEntries(
  entries: TraceEntry[],
  targets: TraceResolveTarget[] | null | undefined,
): ResolvedTraceEntry[] {
  const byId = new Map<string, TraceResolveTarget>();
  for (const target of targets ?? []) {
    if (target?.id) byId.set(target.id, target);
  }
  return entries.map(entry => {
    const target = entry.targetId ? byId.get(entry.targetId) : undefined;
    let opcode: string | null = null;
    try {
      opcode = target?.blocks?.getBlock?.(entry.blockId)?.opcode ?? null;
    } catch {
      opcode = null;
    }
    let targetName: string | null = null;
    try {
      targetName = target?.getName?.() ?? null;
    } catch {
      targetName = null;
    }
    return {...entry, opcode, targetName};
  });
}
