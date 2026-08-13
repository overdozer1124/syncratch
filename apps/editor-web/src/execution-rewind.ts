/**
 * Deterministic rewind foundation: origin snapshot, per-frame journal, and
 * fingerprint recording for scheduler-frame replay.
 *
 * PR 15 adds timeline scrubbing with a playback head (bidirectional scrub
 * without truncating recorded history until branch commit on resume).
 */

import {
  installBackdropResolveCapture,
} from "./execution-rewind-backdrop-resolve.js";
import {
  installSequencerWorkCapture,
} from "./execution-rewind-sequencer-work.js";
import {
  installEdgeBounceCapture,
} from "./execution-rewind-edge-bounce.js";
import {
  installSpriteXYCapture,
} from "./execution-rewind-sprite-xy.js";
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
import {requestRuntimeStageDraw} from "./execution-stage-draw.js";
import {countRunnableNonMonitorThreads} from "./execution-control.js";
import {bindCloneOrderRegistry} from "./execution-rewind-target-identity.js";
import {
  REWIND_MAX_FRAMES,
  type ReplayResult,
  type RewindClearReason,
  type RewindFrame,
  type RewindFrameResult,
  type RewindOrigin,
  type RewindSnapshot,
  type ScrubResult,
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
  ScrubResult,
} from "./execution-rewind-types.js";

export type RewindVmLike = {
  runtime?: unknown;
};

export interface ExecutionRewindOptions {
  captureOrigin?: () => RewindOrigin | null;
  restoreOrigin?: (origin: RewindOrigin) => Promise<void>;
  /** Snapshot live VM state before replay; used to recover after replay failure. */
  captureExecutionCheckpoint?: () => unknown;
  restoreExecutionCheckpoint?: (checkpoint: unknown) => Promise<void>;
  getTraceSize?: () => number;
  onHistoryCleared?: (reason: RewindClearReason) => void;
  /** Called around deterministic replay (load + scheduler steps). */
  onReplayLifecycle?: (phase: "start" | "end") => void;
  /** Move trace display cursor during scrub (no physical truncate). */
  onTraceDisplayCursor?: (traceSize: number) => void;
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
  /** Scrub to a recorded scheduler frame without discarding future history. */
  scrubToFrame(targetFrameIndex: number): Promise<ScrubResult>;
  /** Scrub forward one frame when playback is behind the record frontier. */
  scrubForwardOneFrame(): Promise<ScrubResult>;
  /** Discard recorded frames after the playback head (call before resume). */
  commitPlaybackBranch(): void;
  /** Rewind one scheduler frame (scrub backward, non-destructive). */
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

function frameAtIndex(
  frames: RewindFrame[],
  frameIndex: number,
): RewindFrame | null {
  const frame = frames[frameIndex];
  if (!frame || frame.frameIndex !== frameIndex) return null;
  return frame;
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
  let playbackFrameIndex = 0;
  let isReplaying = false;
  let rewindError: string | null = null;
  let unsupportedOpcodes = new Set<string>();
  let activeExtensionIds: string[] = [];
  let disposed = false;
  let pendingScrubTarget: number | null = null;
  let scrubMutex: Promise<void> = Promise.resolve();

  const recordFrontierFrameIndex = (): number =>
    frames.length > 0 ? frames[frames.length - 1]!.frameIndex : -1;

  const buildSnapshot = (): RewindSnapshot => {
    const frontier = recordFrontierFrameIndex();
    const canScrub =
      frontier >= 1 && rewindError === null && !isReplaying;
    const scrubDepthBack = frontier < 0 ? 0 : playbackFrameIndex;
    const scrubDepthForward =
      frontier < 0 ? 0 : Math.max(0, frontier - playbackFrameIndex);
    return {
      canScrub,
      playbackFrameIndex: frontier < 0 ? 0 : playbackFrameIndex,
      recordFrontierFrameIndex: frontier,
      scrubDepthForward,
      scrubDepthBack,
      canRewind: canScrub && scrubDepthBack > 0,
      rewindDepth: scrubDepthBack,
      isReplaying,
      rewindError,
      unsupportedOpcodes: [...unsupportedOpcodes].sort(),
    };
  };

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
    playbackFrameIndex = 0;
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
  const disposeBackdropResolveCapture = installBackdropResolveCapture({
    runtime: runtime as import("./execution-rewind-backdrop-resolve.js").BackdropCaptureRuntimeLike,
    journal,
  });
  const disposeSequencerWorkCapture = installSequencerWorkCapture({
    runtime: runtime as import("./execution-rewind-sequencer-work.js").SequencerWorkRuntimeLike,
    journal,
  });
  const disposeEdgeBounceCapture = installEdgeBounceCapture({
    runtime: runtime as import("./execution-rewind-edge-bounce.js").EdgeBounceRuntimeLike,
    journal,
  });
  const spriteXYCapture = installSpriteXYCapture({
    runtime: runtime as import("./execution-rewind-sprite-xy.js").SpriteXYRuntimeLike,
    journal,
  });
  const disposeSpriteXYCapture = spriteXYCapture.dispose;
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
    playbackFrameIndex = 0;
    spriteXYCapture.ensureWrapped();
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

    const frontier = recordFrontierFrameIndex();
    if (frontier >= 0 && playbackFrameIndex < frontier) {
      console.warn(
        "[syncratch] execution rewind: resume with commitPlaybackBranch() before recording",
      );
      commitPlaybackBranchInternal();
    }

    const journalStart = journal.size;
    const threadsBefore = countRunnableNonMonitorThreads(runtime);
    journal.beginRecord();
    spriteXYCapture.ensureWrapped();
    let result: unknown;
    try {
      result = innerStep(...args);
    } finally {
      flushPendingPromiseJournalEntries(journal);
      journal.endFrame();
    }
    const journalEnd = journal.size;
    const threadsAfter = countRunnableNonMonitorThreads(runtime);

    if (!origin) {
      return result;
    }

    if (threadsBefore === 0 && threadsAfter === 0) {
      if (journalEnd > journalStart) {
        journal.truncateTo(journalStart);
      }
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
    const traceSize = options.getTraceSize?.() ?? 0;
    frames.push({
      frameIndex,
      traceSize,
      journalStart,
      journalEnd,
      fingerprint: fingerprintResult.fingerprint,
    });
    playbackFrameIndex = frameIndex;
    options.onTraceDisplayCursor?.(traceSize);

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

  const recoverExecutionBaseline = async (checkpoint: unknown) => {
    if (options.restoreExecutionCheckpoint) {
      try {
        await options.restoreExecutionCheckpoint(checkpoint);
        cloneOrderRegistry.reset();
        cloneOrderRegistry.seedOriginalTargets(runtime.targets);
        bindCloneOrderRegistry(cloneOrderRegistry);
        return;
      } catch {
        // Fall back to green-flag origin when checkpoint restore fails.
      }
    }
    await recoverOriginBaseline();
  };

  const invalidateHistoryAfterReplayFailure = () => {
    frames = [];
    nextFrameIndex = 0;
    playbackFrameIndex = 0;
    journal.clear();
    cloneOrderRegistry.reset();
    options.onHistoryCleared?.("replay-failure");
  };

  function commitPlaybackBranchInternal(): void {
    const frontier = recordFrontierFrameIndex();
    if (frontier < 0 || playbackFrameIndex >= frontier) return;

    frames = truncateFramesAfter(frames, playbackFrameIndex);
    nextFrameIndex = playbackFrameIndex + 1;
    const frame = frameAtIndex(frames, playbackFrameIndex);
    if (frame) {
      options.onTraceTruncate?.(frame.traceSize);
    }
  }

  const runDeterministicReplay = async (
    targetFrameIndex: number,
    mode: "scrub" | "test",
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
    const executionCheckpoint = options.captureExecutionCheckpoint?.();
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
        onRestored: spriteXYCapture.ensureWrapped,
      });
      if (!result.ok) {
        markUnsupported();
        if (executionCheckpoint != null) {
          await recoverExecutionBaseline(executionCheckpoint);
        } else {
          await recoverOriginBaseline();
        }
        invalidateHistoryAfterReplayFailure();
        return result;
      }

      if (mode === "scrub") {
        playbackFrameIndex = targetFrameIndex;
        const frame = frameAtIndex(frames, targetFrameIndex);
        if (frame) {
          options.onTraceDisplayCursor?.(frame.traceSize);
        }
        requestRuntimeStageDraw(runtime);
      }

      return result;
    } finally {
      isReplaying = false;
      options.onReplayLifecycle?.("end");
      requestRuntimeStageDraw(runtime);
    }
  };

  const runScrubLoop = async (initialTarget: number): Promise<ScrubResult> => {
    let target = initialTarget;
    while (true) {
      pendingScrubTarget = null;
      if (target === playbackFrameIndex) {
        return {
          ok: true,
          playbackFrameIndex,
          error: null,
        };
      }

      const result = await runDeterministicReplay(target, "scrub");
      if (!result.ok) {
        return {
          ok: false,
          playbackFrameIndex,
          error: result.error,
        };
      }

      if (pendingScrubTarget === null) {
        return {
          ok: true,
          playbackFrameIndex,
          error: null,
        };
      }
      target = pendingScrubTarget;
    }
  };

  const enqueueScrub = (targetFrameIndex: number): Promise<ScrubResult> => {
    pendingScrubTarget = targetFrameIndex;
    const job = scrubMutex.then(() => runScrubLoop(targetFrameIndex));
    scrubMutex = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  };

  const validateScrubTarget = (
    targetFrameIndex: number,
  ): string | null => {
    const snapshot = buildSnapshot();
    if (!snapshot.canScrub) {
      return rewindError ?? "Scrub is unavailable";
    }
    const frontier = snapshot.recordFrontierFrameIndex;
    if (targetFrameIndex < 0) {
      return "Already at the origin scheduler frame";
    }
    if (targetFrameIndex > frontier) {
      return `Frame ${targetFrameIndex} was not recorded`;
    }
    if (!frameAtIndex(frames, targetFrameIndex)) {
      return `Frame ${targetFrameIndex} was not recorded`;
    }
    return null;
  };

  const handle: ExecutionRewindHandle = {
    getSnapshot(): RewindSnapshot {
      return buildSnapshot();
    },
    clearRewindHistory(reason: RewindClearReason) {
      clearRewindHistory(reason);
    },
    async replayToFrame(targetFrameIndex: number): Promise<ReplayResult> {
      return runDeterministicReplay(targetFrameIndex, "test");
    },
    async scrubToFrame(targetFrameIndex: number): Promise<ScrubResult> {
      const error = validateScrubTarget(targetFrameIndex);
      if (error) {
        return {
          ok: false,
          playbackFrameIndex,
          error,
        };
      }
      return enqueueScrub(targetFrameIndex);
    },
    async scrubForwardOneFrame(): Promise<ScrubResult> {
      const frontier = recordFrontierFrameIndex();
      if (playbackFrameIndex >= frontier) {
        return {
          ok: false,
          playbackFrameIndex,
          error: "At record frontier",
        };
      }
      return enqueueScrub(playbackFrameIndex + 1);
    },
    commitPlaybackBranch() {
      commitPlaybackBranchInternal();
    },
    async rewindFrame(): Promise<RewindFrameResult> {
      const snapshot = buildSnapshot();
      if (!snapshot.canScrub || snapshot.scrubDepthBack <= 0) {
        return {
          ok: false,
          targetFrameIndex: -1,
          error: rewindError ?? "Rewind is unavailable",
        };
      }

      const targetFrameIndex = playbackFrameIndex - 1;
      const result = await enqueueScrub(targetFrameIndex);
      return {
        ok: result.ok,
        targetFrameIndex: result.ok ? targetFrameIndex : -1,
        error: result.error,
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
      disposeBackdropResolveCapture();
      disposeSequencerWorkCapture();
      disposeEdgeBounceCapture();
      disposeSpriteXYCapture();
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
