/**
 * Deterministic rewind foundation: origin snapshot, per-frame journal, and
 * fingerprint recording for scheduler-frame replay.
 *
 * PR 1 exposes recording + replayToFrame() for tests. PR 2 adds rewindFrame(),
 * trace truncation, and replay lifecycle hooks for side-effect suppression.
 * PR 3 wires the toolbar button; PR 4 invalidates history on project/code changes.
 * PR 5 journals loudness, ask/answer, video sensing, and extension reporter opcodes.
 * PR 6 journals broadcast-and-wait thread order via startHats capture.
 * PR 7 journals async primitive promise resolutions (ask/answer, say/think for secs).
 * PR 10 extends broadcastOrder capture to backdrop-switch-and-wait hats.
 */

import {
  installBroadcastOrderCapture,
} from "./execution-rewind-broadcast-order.js";
import {
  flushPendingPromiseJournalEntries,
  installPromiseResolveCapture,
} from "./execution-rewind-promise-resolve.js";
import {
  CloneOrderRegistry,
  installCloneOrderCapture,
} from "./execution-rewind-clone-order.js";
import {
  computeFrameFingerprint,
  computeProjectBlockGraphHash,
  type RewindRuntimeLike,
} from "./execution-rewind-fingerprint.js";
import {
  extractExtensionIds,
  IMPLEMENTED_JOURNAL_KINDS,
} from "./execution-rewind-non-deterministic.js";
import {installJournalCapture} from "./execution-rewind-journal-capture.js";
import {RewindJournal} from "./execution-rewind-journal.js";
import {replayToFrame, truncateFramesAfter} from "./execution-rewind-replay.js";
import {bindCloneOrderRegistry} from "./execution-rewind-target-identity.js";
import {
  REWIND_MAX_FRAMES,
  type ReplayResult,
  type RewindClearReason,
  type RewindFrame,
  type RewindFrameResult,
  type RewindOrigin,
  type RewindSnapshot,
} from "./execution-rewind-types.js";

const REWIND_FLAG = "_syncratchExecutionRewindInstalled";
const REWIND_HANDLE = "_syncratchExecutionRewindHandle";
const REWIND_UNSUPPORTED_ERROR = "この実行は正確に巻き戻せません";

export type {
  ReplayResult,
  RewindClearReason,
  RewindFrame,
  RewindFrameResult,
  RewindOrigin,
  RewindSnapshot,
} from "./execution-rewind-types.js";

export type RewindVmLike = {
  runtime?: unknown;
};

export interface ExecutionRewindOptions {
  captureOrigin?: () => RewindOrigin | null;
  restoreOrigin?: (origin: RewindOrigin) => Promise<void>;
  getTraceSize?: () => number;
  onHistoryCleared?: (reason: RewindClearReason) => void;
  /** Called around deterministic replay (load + scheduler steps). */
  onReplayLifecycle?: (phase: "start" | "end") => void;
  /** Truncate execution trace to a recorded scheduler frame boundary. */
  onTraceTruncate?: (traceSize: number) => void;
  maxFrames?: number;
  /** Inject a shared journal (used by unit tests). */
  journal?: RewindJournal;
  /** Inject a shared clone-order registry (used by unit tests). */
  cloneOrderRegistry?: CloneOrderRegistry;
}

export interface ExecutionRewindHandle {
  getSnapshot(): RewindSnapshot;
  clearRewindHistory(reason: RewindClearReason): void;
  /** Test API: replay to a recorded scheduler frame index. */
  replayToFrame(targetFrameIndex: number): Promise<ReplayResult>;
  /** Rewind one scheduler frame and discard future history. */
  rewindFrame(): Promise<RewindFrameResult>;
  getFrames(): RewindFrame[];
  getOrigin(): RewindOrigin | null;
  dispose(): void;
}

function cloneOrigin(origin: RewindOrigin): RewindOrigin {
  return {
    document: structuredClone(origin.document),
    assets: origin.assets,
    projectSessionId: origin.projectSessionId,
    blockGraphHash: origin.blockGraphHash,
    vmProjectJson: structuredClone(origin.vmProjectJson ?? null),
  };
}

export function installExecutionRewind(
  vm: RewindVmLike,
  options: ExecutionRewindOptions = {},
): ExecutionRewindHandle | null {
  const runtime =
    vm.runtime && typeof vm.runtime === "object"
      ? (vm.runtime as RewindRuntimeLike & {
          _step?: (...args: unknown[]) => unknown;
          on?: (event: string, handler: (...args: unknown[]) => void) => void;
          off?: (event: string, handler: (...args: unknown[]) => void) => void;
          [REWIND_FLAG]?: boolean;
          [REWIND_HANDLE]?: ExecutionRewindHandle;
        })
      : null;
  if (!runtime || typeof runtime._step !== "function") return null;

  const existing = runtime[REWIND_HANDLE];
  if (runtime[REWIND_FLAG] && existing) {
    return existing;
  }

  const maxFrames = Math.max(1, options.maxFrames ?? REWIND_MAX_FRAMES);
  const journal = options.journal ?? new RewindJournal();
  const cloneOrderRegistry = options.cloneOrderRegistry ?? new CloneOrderRegistry();
  bindCloneOrderRegistry(cloneOrderRegistry);

  let origin: RewindOrigin | null = null;
  let frames: RewindFrame[] = [];
  let nextFrameIndex = 0;
  let isReplaying = false;
  let rewindError: string | null = null;
  let unsupportedOpcodes = new Set<string>();
  let activeExtensionIds: string[] = [];
  let disposed = false;

  const markUnsupported = (opcode?: string) => {
    if (opcode) unsupportedOpcodes.add(opcode);
    rewindError = REWIND_UNSUPPORTED_ERROR;
  };

  const rawStep = runtime._step;
  const innerStep = rawStep.bind(runtime);

  const clearRewindHistory = (reason: RewindClearReason) => {
    origin = null;
    frames = [];
    nextFrameIndex = 0;
    rewindError = null;
    unsupportedOpcodes = new Set();
    activeExtensionIds = [];
    journal.clear();
    cloneOrderRegistry.reset();
    options.onHistoryCleared?.(reason);
  };

  const disposeJournalCapture = installJournalCapture(
    runtime as import("./execution-rewind-journal-capture.js").JournalCaptureRuntimeLike,
    journal,
    {
      getExtensionIds: () => activeExtensionIds,
      onUnsupportedInput: ({opcode, journalKind}) => {
        if (!IMPLEMENTED_JOURNAL_KINDS.has(journalKind)) {
          markUnsupported(opcode);
        }
      },
    },
  );
  const disposeCloneOrderCapture = installCloneOrderCapture({
    runtime,
    registry: cloneOrderRegistry,
    journal,
  });
  const disposeBroadcastOrderCapture = installBroadcastOrderCapture({
    runtime,
    journal,
  });
  const disposePromiseResolveCapture = installPromiseResolveCapture({
    runtime: runtime as import("./execution-rewind-promise-resolve.js").PromiseCaptureRuntimeLike,
    journal,
    getExtensionIds: () => activeExtensionIds,
  });

  const onProjectStart = () => {
    if (isReplaying) return;
    clearRewindHistory("green-flag");
    cloneOrderRegistry.reset();
    cloneOrderRegistry.seedOriginalTargets(runtime.targets);
    bindCloneOrderRegistry(cloneOrderRegistry);
    const captured = options.captureOrigin?.() ?? null;
    if (captured) {
      origin = cloneOrigin(captured);
      activeExtensionIds = extractExtensionIds(origin);
    }
    nextFrameIndex = 0;
  };
  runtime.on?.("PROJECT_START", onProjectStart);

  runtime._step = (...args: unknown[]) => {
    if (disposed) return innerStep(...args);

    if (isReplaying) {
      return undefined;
    }

    if (journal.getMode() === "replay") {
      return innerStep(...args);
    }

    const journalStart = journal.size;
    journal.beginRecord();
    let result: unknown;
    try {
      result = innerStep(...args);
    } finally {
      flushPendingPromiseJournalEntries(journal);
      journal.endFrame();
    }
    const journalEnd = journal.size;

    if (!origin) {
      return result;
    }

    if (journal.exceedsByteLimit()) {
      clearRewindHistory("journal-limit");
      markUnsupported();
      return result;
    }

    const frameIndex = nextFrameIndex;
    nextFrameIndex += 1;
    const fingerprintResult = computeFrameFingerprint({
      frameIndex,
      runtime,
      blockGraphHash: origin.blockGraphHash,
    });
    if (!fingerprintResult.supported) {
      markUnsupported();
    }
    frames.push({
      frameIndex,
      traceSize: options.getTraceSize?.() ?? 0,
      journalStart,
      journalEnd,
      fingerprint: fingerprintResult.fingerprint,
    });

    if (frames.length > maxFrames) {
      clearRewindHistory("frame-limit");
      markUnsupported();
    }

    return result;
  };
  runtime[REWIND_FLAG] = true;

  const recoverOriginBaseline = async () => {
    if (!origin || !options.restoreOrigin) return;
    try {
      await options.restoreOrigin(origin);
      cloneOrderRegistry.reset();
      cloneOrderRegistry.seedOriginalTargets(runtime.targets);
      bindCloneOrderRegistry(cloneOrderRegistry);
    } catch {
      // Recovery is best-effort; callers should treat failed replay as terminal.
    }
  };

  const invalidateHistoryAfterReplayFailure = () => {
    frames = [];
    nextFrameIndex = 0;
    journal.clear();
    cloneOrderRegistry.reset();
    options.onTraceTruncate?.(0);
    options.onHistoryCleared?.("replay-failure");
  };

  const runDeterministicReplay = async (
    targetFrameIndex: number,
  ): Promise<ReplayResult> => {
    if (!origin) {
      return {
        ok: false,
        targetFrameIndex,
        expectedFingerprint: null,
        actualFingerprint: null,
        error: "Rewind origin is unavailable",
      };
    }
    if (!options.restoreOrigin) {
      return {
        ok: false,
        targetFrameIndex,
        expectedFingerprint: null,
        actualFingerprint: null,
        error: "restoreOrigin is not configured",
      };
    }
    if (rewindError) {
      return {
        ok: false,
        targetFrameIndex,
        expectedFingerprint: null,
        actualFingerprint: null,
        error: rewindError,
      };
    }

    options.onReplayLifecycle?.("start");
    isReplaying = true;
    try {
      const result = await replayToFrame({
        origin,
        frames,
        journal,
        targetFrameIndex,
        runtime,
        cloneOrderRegistry,
        step: () => innerStep(),
        restoreOrigin: options.restoreOrigin,
        getTraceSize: options.getTraceSize,
      });
      if (!result.ok) {
        markUnsupported();
        await recoverOriginBaseline();
        invalidateHistoryAfterReplayFailure();
      }
      return result;
    } finally {
      isReplaying = false;
      options.onReplayLifecycle?.("end");
    }
  };

  const handle: ExecutionRewindHandle = {
    getSnapshot(): RewindSnapshot {
      const rewindDepth = frames.length > 0 ? frames.length - 1 : 0;
      return {
        canRewind: rewindDepth > 0 && rewindError === null && !isReplaying,
        rewindDepth,
        isReplaying,
        rewindError,
        unsupportedOpcodes: [...unsupportedOpcodes].sort(),
      };
    },
    clearRewindHistory(reason: RewindClearReason) {
      clearRewindHistory(reason);
    },
    async replayToFrame(targetFrameIndex: number): Promise<ReplayResult> {
      return runDeterministicReplay(targetFrameIndex);
    },
    async rewindFrame(): Promise<RewindFrameResult> {
      const rewindDepth = frames.length > 0 ? frames.length - 1 : 0;
      const canRewind = rewindDepth > 0 && rewindError === null && !isReplaying;
      if (!canRewind) {
        return {
          ok: false,
          targetFrameIndex: -1,
          error: rewindError ?? "Rewind is unavailable",
        };
      }
      if (frames.length < 2) {
        return {
          ok: false,
          targetFrameIndex: -1,
          error: "Rewind history is too shallow",
        };
      }

      const currentFrameIndex = frames[frames.length - 1]!.frameIndex;
      const targetFrameIndex = currentFrameIndex - 1;
      if (targetFrameIndex < 0) {
        return {
          ok: false,
          targetFrameIndex,
          error: "Already at the origin scheduler frame",
        };
      }

      const targetFrame = frames.find(frame => frame.frameIndex === targetFrameIndex);
      if (!targetFrame) {
        return {
          ok: false,
          targetFrameIndex,
          error: `Frame ${targetFrameIndex} was not recorded`,
        };
      }

      const result = await runDeterministicReplay(targetFrameIndex);
      if (!result.ok) {
        return {
          ok: false,
          targetFrameIndex,
          error: result.error,
        };
      }

      frames = truncateFramesAfter(frames, targetFrameIndex);
      nextFrameIndex = targetFrameIndex + 1;
      options.onTraceTruncate?.(targetFrame.traceSize);

      return {
        ok: true,
        targetFrameIndex,
        error: null,
      };
    },
    getFrames(): RewindFrame[] {
      return frames.map(frame => ({...frame}));
    },
    getOrigin(): RewindOrigin | null {
      return origin ? cloneOrigin(origin) : null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      runtime.off?.("PROJECT_START", onProjectStart);
      runtime._step = rawStep;
      runtime[REWIND_FLAG] = false;
      delete runtime[REWIND_HANDLE];
      disposeBroadcastOrderCapture();
      disposePromiseResolveCapture();
      disposeCloneOrderCapture();
      disposeJournalCapture();
      bindCloneOrderRegistry(null);
      clearRewindHistory("dispose");
    },
  };

  runtime[REWIND_HANDLE] = handle;
  return handle;
}

/** Convenience for callers that build a RewindOrigin from the live VM. */
export function createRewindOrigin(input: {
  document: RewindOrigin["document"];
  assets: Map<string, Uint8Array>;
  projectSessionId: number;
  runtime: RewindRuntimeLike | null | undefined;
  vmProjectJson?: unknown;
}): RewindOrigin {
  return {
    document: structuredClone(input.document),
    assets: input.assets,
    projectSessionId: input.projectSessionId,
    blockGraphHash: computeProjectBlockGraphHash(input.runtime),
    vmProjectJson: structuredClone(input.vmProjectJson ?? null),
  };
}

export {
  CloneOrderRegistry,
  computeFrameFingerprint,
  computeProjectBlockGraphHash,
  extractExtensionIds,
  RewindJournal,
  replayToFrame,
};
