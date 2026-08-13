import {stableJson} from "@blocksync/sb3-tools";
import {
  stableTargetIdentity,
  type StableTargetLike,
} from "./execution-rewind-target-identity.js";
import {hashVmVisibleBlockGraph} from "./workspace-desync-diagnostics.js";

export type RewindStackFrameLike = {
  warpMode?: boolean;
  isLoop?: boolean;
  loop?: boolean;
  params?: Record<string, unknown> | null;
  executionContext?: Record<string, unknown> | null;
  waitingReporter?: string | null;
  reporting?: string;
  justReported?: unknown;
  reported?: unknown;
};

export type RewindThreadLike = {
  topBlock?: string | null;
  peekStack?: () => string | null | undefined;
  blockGlowInFrame?: string | null;
  updateMonitor?: boolean;
  isKilled?: boolean;
  status?: number;
  stack?: string[];
  stackFrames?: RewindStackFrameLike[];
  target?: RewindTargetLike | null;
};

export type RewindTargetLike = StableTargetLike & {
  x?: number;
  y?: number;
  direction?: number;
  size?: number;
  visible?: boolean;
  currentCostume?: number;
  variables?: Record<string, unknown>;
  blocks?: {
    _blocks?: Record<string, unknown>;
    getBlock?: (id: string) => unknown;
  };
};

export type RewindRuntimeLike = {
  threads?: RewindThreadLike[];
  targets?: RewindTargetLike[];
};

export type FrameFingerprintResult = {
  fingerprint: string;
  supported: boolean;
  unsupportedReason: string | null;
};

type NormalizedStackFrame = {
  warpMode: boolean;
  isLoop: boolean;
  params: unknown;
  executionContext: unknown;
  waitingReporter: string | null;
  justReported: unknown;
  reported: unknown;
};

class StackFrameNormalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StackFrameNormalizationError";
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePrimitive(value: unknown): unknown {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new StackFrameNormalizationError("Non-finite number in stack frame");
    }
    return value;
  }
  throw new StackFrameNormalizationError(
    `Unsupported primitive type: ${typeof value}`,
  );
}

function normalizeJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 8) {
    throw new StackFrameNormalizationError("Stack frame value is too deep");
  }
  if (value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return normalizePrimitive(value);
  }
  if (Array.isArray(value)) {
    return value.map(entry => normalizeJsonValue(entry, depth + 1));
  }
  if (isPlainObject(value)) {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      normalized[key] = normalizeJsonValue(value[key], depth + 1);
    }
    return normalized;
  }
  throw new StackFrameNormalizationError(
    `Unsupported stack frame value type: ${typeof value}`,
  );
}

function normalizeTimerContext(
  context: Record<string, unknown>,
): {__waitTimer: {duration: number; pending: boolean}} {
  const duration = context.duration;
  if (typeof duration !== "number" || !Number.isFinite(duration)) {
    throw new StackFrameNormalizationError("Invalid wait timer duration");
  }

  const timer = context.timer as
    | {timeElapsed?: () => number}
    | null
    | undefined;
  let pending = true;
  if (timer && typeof timer.timeElapsed === "function") {
    try {
      pending = timer.timeElapsed() < duration;
    } catch {
      pending = true;
    }
  }

  return {
    __waitTimer: {
      duration,
      pending,
    },
  };
}

function normalizeVariableReference(value: unknown): unknown {
  if (!isPlainObject(value)) {
    throw new StackFrameNormalizationError("Invalid variable reference");
  }
  const name = value.name;
  const type = value.type;
  if (typeof name !== "string" || typeof type !== "string") {
    throw new StackFrameNormalizationError("Variable reference is incomplete");
  }
  return {
    __variableRef: {
      name,
      type,
    },
  };
}

function normalizeExecutionContext(
  context: Record<string, unknown> | null | undefined,
): unknown {
  if (context === null || context === undefined) return null;
  if (!isPlainObject(context)) {
    throw new StackFrameNormalizationError("executionContext must be an object");
  }

  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(context).sort()) {
    const value = context[key];
    if (key === "timer" || key === "startedThreads" || key === "broadcastVar") {
      continue;
    }
    if (value === undefined || typeof value === "function") {
      throw new StackFrameNormalizationError(
        `Unsupported executionContext entry: ${key}`,
      );
    }
    if (key === "duration" && "timer" in context) {
      continue;
    }
    if (isPlainObject(value) && typeof value.name === "string" && "type" in value) {
      normalized[key] = normalizeVariableReference(value);
      continue;
    }
    normalized[key] = normalizeJsonValue(value);
  }

  if ("timer" in context) {
    normalized.__waitTimer = normalizeTimerContext(context).__waitTimer;
  }

  return normalized;
}

function normalizeReportedEntry(value: unknown): unknown {
  if (!isPlainObject(value)) {
    throw new StackFrameNormalizationError("reported entry must be an object");
  }
  const opCached = value.opCached;
  if (typeof opCached !== "string" || !opCached) {
    throw new StackFrameNormalizationError("reported entry missing opCached");
  }
  return {
    opCached,
    inputValue: normalizeJsonValue(value.inputValue),
  };
}

function normalizeReported(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) {
    throw new StackFrameNormalizationError("reported must be an array");
  }
  return value.map(entry => normalizeReportedEntry(entry));
}

function normalizeWaitingReporter(
  waitingReporter: unknown,
  reporting: unknown,
): string | null {
  if (waitingReporter === null || waitingReporter === undefined) {
    if (typeof reporting === "string" && reporting) return reporting;
    return null;
  }
  if (typeof waitingReporter !== "string") {
    throw new StackFrameNormalizationError("waitingReporter must be a string");
  }
  return waitingReporter;
}

function normalizeStackFrame(
  frame: RewindStackFrameLike,
): NormalizedStackFrame | null {
  try {
    return {
      warpMode: Boolean(frame.warpMode),
      isLoop: Boolean(frame.isLoop ?? frame.loop),
      params: frame.params === null || frame.params === undefined
        ? null
        : normalizeJsonValue(frame.params),
      executionContext: normalizeExecutionContext(frame.executionContext),
      waitingReporter: normalizeWaitingReporter(
        frame.waitingReporter,
        frame.reporting,
      ),
      justReported:
        frame.justReported === undefined
          ? null
          : normalizeJsonValue(frame.justReported),
      reported: normalizeReported(frame.reported),
    };
  } catch {
    return null;
  }
}

/** Stack top for fingerprints — ignore blockGlowInFrame (UI glow can diverge on replay). */
function readStackTopBlock(thread: RewindThreadLike): string | null {
  try {
    const id = thread.peekStack?.();
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}

function hashStackFrames(
  frames: RewindStackFrameLike[] | undefined,
): {hash: string; supported: boolean} {
  if (!Array.isArray(frames) || frames.length === 0) {
    return {hash: "", supported: true};
  }

  const normalized: NormalizedStackFrame[] = [];
  for (const frame of frames) {
    const next = normalizeStackFrame(frame);
    if (!next) return {hash: "", supported: false};
    normalized.push(next);
  }

  return {
    hash: normalized.map(frame => stableJson(frame)).join(";"),
    supported: true,
  };
}

function hashTargetState(target: RewindTargetLike): string {
  const vars = target.variables ?? {};
  const sortedVars = Object.keys(vars)
    .sort()
    .map(key => `${key}=${stableJson(vars[key])}`)
    .join(",");
  return [
    stableTargetIdentity(target),
    target.x ?? 0,
    target.y ?? 0,
    target.direction ?? 90,
    target.size ?? 100,
    target.visible === false ? "0" : "1",
    target.currentCostume ?? 0,
    sortedVars,
  ].join("|");
}

function hashThreadState(
  thread: RewindThreadLike,
): {hash: string; supported: boolean} {
  const target = thread.target;
  const stack = Array.isArray(thread.stack) ? thread.stack.join(">") : "";
  const stackFrames = hashStackFrames(thread.stackFrames);
  return {
    hash: [
      stableTargetIdentity(target ?? {}),
      thread.topBlock ?? "",
      readStackTopBlock(thread) ?? "",
      thread.status ?? "",
      thread.isKilled ? "1" : "0",
      stack,
      stackFrames.hash,
    ].join(":"),
    supported: stackFrames.supported,
  };
}

/** Aggregate visible block graph across all targets. */
export function computeProjectBlockGraphHash(
  runtime: RewindRuntimeLike | null | undefined,
): string {
  const targets = runtime?.targets;
  if (!Array.isArray(targets) || targets.length === 0) return "0";
  const parts = targets
    .map(target => {
      const blocks = target.blocks?._blocks as
        | Record<string, import("./workspace-desync-diagnostics.js").VmBlockLike>
        | undefined;
      return `${stableTargetIdentity(target)}=${hashVmVisibleBlockGraph(blocks)}`;
    })
    .sort();
  return parts.join("|");
}

export function computeFrameFingerprint(input: {
  frameIndex: number;
  runtime: RewindRuntimeLike | null | undefined;
  blockGraphHash: string;
}): FrameFingerprintResult {
  const runtime = input.runtime;
  let supported = true;
  const threads = (runtime?.threads ?? [])
    .filter(thread => thread && !thread.updateMonitor)
    .map(thread => {
      const hashed = hashThreadState(thread);
      if (!hashed.supported) supported = false;
      return hashed.hash;
    })
    .sort();
  const targets = (runtime?.targets ?? []).map(hashTargetState).sort();
  return {
    fingerprint: stableJson({
      frameIndex: input.frameIndex,
      blockGraphHash: input.blockGraphHash,
      threads,
      targets,
    }),
    supported,
    unsupportedReason: supported
      ? null
      : "Stack frame state could not be normalized for rewind",
  };
}

export {StackFrameNormalizationError, normalizeStackFrame};
