import {stableJson} from "@blocksync/sb3-tools";
import {hashVmVisibleBlockGraph} from "./workspace-desync-diagnostics.js";

export type RewindThreadLike = {
  topBlock?: string | null;
  peekStack?: () => string | null | undefined;
  blockGlowInFrame?: string | null;
  updateMonitor?: boolean;
  isKilled?: boolean;
  status?: number;
  target?: RewindTargetLike | null;
};

export type RewindTargetLike = {
  id?: string;
  isStage?: boolean;
  getName?: () => string;
  /** Stable clone index assigned by scratch-vm (original targets omit this). */
  cloneIndex?: number;
  x?: number;
  y?: number;
  direction?: number;
  visible?: boolean;
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

function readCurrentBlock(thread: RewindThreadLike): string | null {
  let id: unknown = thread.blockGlowInFrame;
  if (typeof id !== "string" || !id) {
    try {
      id = thread.peekStack?.();
    } catch {
      id = null;
    }
  }
  return typeof id === "string" && id ? id : null;
}

function targetIdentity(target: RewindTargetLike): string {
  const name = (() => {
    try {
      return target.getName?.() ?? "";
    } catch {
      return "";
    }
  })();
  const clone =
    typeof target.cloneIndex === "number" ? String(target.cloneIndex) : "orig";
  return `${target.id ?? ""}:${clone}:${name}`;
}

function hashTargetState(target: RewindTargetLike): string {
  const vars = target.variables ?? {};
  const sortedVars = Object.keys(vars)
    .sort()
    .map(key => `${key}=${stableJson(vars[key])}`)
    .join(",");
  return [
    targetIdentity(target),
    target.x ?? 0,
    target.y ?? 0,
    target.direction ?? 0,
    target.visible === false ? "0" : "1",
    sortedVars,
  ].join("|");
}

function hashThreadState(thread: RewindThreadLike): string {
  const target = thread.target;
  return [
    targetIdentity(target ?? {}),
    thread.topBlock ?? "",
    readCurrentBlock(thread) ?? "",
    thread.status ?? "",
    thread.isKilled ? "1" : "0",
  ].join(":");
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
      return `${targetIdentity(target)}=${hashVmVisibleBlockGraph(blocks)}`;
    })
    .sort();
  return parts.join("|");
}

export function computeFrameFingerprint(input: {
  frameIndex: number;
  runtime: RewindRuntimeLike | null | undefined;
  blockGraphHash: string;
}): string {
  const runtime = input.runtime;
  const threads = (runtime?.threads ?? [])
    .filter(thread => thread && !thread.updateMonitor)
    .map(hashThreadState)
    .sort();
  const targets = (runtime?.targets ?? [])
    .map(hashTargetState)
    .sort();
  return stableJson({
    frameIndex: input.frameIndex,
    blockGraphHash: input.blockGraphHash,
    threads,
    targets,
  });
}
