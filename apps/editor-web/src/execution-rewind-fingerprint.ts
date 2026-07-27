import {stableJson} from "@blocksync/sb3-tools";
import {stableTargetIdentity} from "./execution-rewind-target-identity.js";
import {hashVmVisibleBlockGraph} from "./workspace-desync-diagnostics.js";

export type RewindStackFrameLike = {
  warpMode?: boolean;
  loop?: boolean;
  params?: Record<string, unknown> | null;
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

export type RewindTargetLike = {
  id?: string;
  isStage?: boolean;
  isOriginal?: boolean;
  getName?: () => string;
  layerOrder?: number;
  cloneIndex?: number;
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

function hashStackFrames(frames: RewindStackFrameLike[] | undefined): string {
  if (!Array.isArray(frames) || frames.length === 0) return "";
  return frames
    .map(frame =>
      stableJson({
        warpMode: Boolean(frame.warpMode),
        loop: Boolean(frame.loop),
        params: frame.params ?? null,
      }),
    )
    .join(";");
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

function hashThreadState(thread: RewindThreadLike): string {
  const target = thread.target;
  const stack = Array.isArray(thread.stack) ? thread.stack.join(">") : "";
  return [
    stableTargetIdentity(target ?? {}),
    thread.topBlock ?? "",
    readCurrentBlock(thread) ?? "",
    thread.status ?? "",
    thread.isKilled ? "1" : "0",
    stack,
    hashStackFrames(thread.stackFrames),
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
      return `${stableTargetIdentity(target)}=${hashVmVisibleBlockGraph(blocks)}`;
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
  const targets = (runtime?.targets ?? []).map(hashTargetState).sort();
  return stableJson({
    frameIndex: input.frameIndex,
    blockGraphHash: input.blockGraphHash,
    threads,
    targets,
  });
}
