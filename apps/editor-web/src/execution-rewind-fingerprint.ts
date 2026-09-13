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
      return null;
    }
    return value;
  }
  return null;
}

function normalizeJsonValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return null;
  if (value === undefined) return null;
  if (value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return normalizePrimitive(value);
  }
  if (typeof value === "function") return null;
  if (Array.isArray(value)) {
    return value.map(entry => normalizeJsonValue(entry, depth + 1));
  }
  if (isPlainObject(value)) {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const next = value[key];
      if (typeof next === "function") continue;
      normalized[key] = normalizeJsonValue(next, depth + 1);
    }
    return normalized;
  }
  return null;
}

function normalizeTimerContext(
  context: Record<string, unknown>,
): {__waitTimer: {duration: number; pending: boolean}} | null {
  const duration = context.duration;
  if (typeof duration !== "number" || !Number.isFinite(duration)) {
    return null;
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
  if (!isPlainObject(value)) return null;
  const name = value.name;
  const type = value.type;
  if (typeof name !== "string" || typeof type !== "string") return null;
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
  if (!isPlainObject(context)) return null;

  const normalized: Record<string, unknown> = {};
  for (const key of Object.keys(context).sort()) {
    const value = context[key];
    if (key === "timer" || key === "startedThreads" || key === "broadcastVar") {
      continue;
    }
    if (value === undefined || typeof value === "function") {
      continue;
    }
    if (key === "duration" && "timer" in context) {
      continue;
    }
    if (isPlainObject(value) && typeof value.name === "string" && "type" in value) {
      const ref = normalizeVariableReference(value);
      if (ref) normalized[key] = ref;
      continue;
    }
    normalized[key] = normalizeJsonValue(value);
  }

  if ("timer" in context) {
    const waitTimer = normalizeTimerContext(context);
    if (waitTimer) {
      normalized.__waitTimer = waitTimer.__waitTimer;
    }
  }

  return normalized;
}

function normalizeStackFrame(
  frame: RewindStackFrameLike,
): NormalizedStackFrame {
  return {
    warpMode: Boolean(frame.warpMode),
    isLoop: Boolean(frame.isLoop ?? frame.loop),
    params: frame.params === null || frame.params === undefined
      ? null
      : normalizeJsonValue(frame.params),
    executionContext: normalizeExecutionContext(frame.executionContext),
  };
}

function hashStackFrames(
  frames: RewindStackFrameLike[] | undefined,
): {hash: string; supported: boolean} {
  if (!Array.isArray(frames) || frames.length === 0) {
    return {hash: "", supported: true};
  }

  const normalized = frames.map(frame => normalizeStackFrame(frame));
  return {
    hash: normalized.map(frame => stableJson(frame)).join(";"),
    supported: true,
  };
}

function hashVariableState(variable: unknown): string {
  if (!isPlainObject(variable)) return stableJson(normalizeJsonValue(variable));
  return stableJson({
    name: typeof variable.name === "string" ? variable.name : "",
    type: typeof variable.type === "string" ? variable.type : "",
    value: normalizeJsonValue(variable.value),
  });
}

function hashTargetState(target: RewindTargetLike): string {
  const vars = target.variables ?? {};
  const sortedVars = Object.keys(vars)
    .sort()
    .map(key => `${key}=${hashVariableState(vars[key])}`)
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
