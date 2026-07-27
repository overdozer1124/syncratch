/**
 * Deterministic rewind foundation: origin snapshot, per-frame journal, and
 * fingerprint recording for scheduler-frame replay.
 *
 * PR 1 exposes recording + replayToFrame() for tests. UI and rewindFrame() land
 * in later PRs.
 */

import {
  computeFrameFingerprint,
  computeProjectBlockGraphHash,
  type RewindRuntimeLike,
} from "./execution-rewind-fingerprint.js";
import {installJournalCapture} from "./execution-rewind-journal-capture.js";
import {RewindJournal} from "./execution-rewind-journal.js";
import {replayToFrame} from "./execution-rewind-replay.js";
import {
  REWIND_MAX_FRAMES,
  type ReplayResult,
  type RewindClearReason,
  type RewindFrame,
  type RewindOrigin,
  type RewindSnapshot,
} from "./execution-rewind-types.js";

const REWIND_FLAG = "_syncratchExecutionRewindInstalled";
const REWIND_HANDLE = "_syncratchExecutionRewindHandle";

export type {
  ReplayResult,
  RewindClearReason,
  RewindFrame,
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
  maxFrames?: number;
  /** Inject a shared journal (used by unit tests). */
  journal?: RewindJournal;
}

export interface ExecutionRewindHandle {
  getSnapshot(): RewindSnapshot;
  clearRewindHistory(reason: RewindClearReason): void;
  /** Test / PR2 API: replay to a recorded scheduler frame index. */
  replayToFrame(targetFrameIndex: number): Promise<ReplayResult>;
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
  let origin: RewindOrigin | null = null;
  let frames: RewindFrame[] = [];
  let nextFrameIndex = 0;
  let isReplaying = false;
  let rewindError: string | null = null;
  let disposed = false;

  const rawStep = runtime._step;
  const innerStep = rawStep.bind(runtime);

  const clearRewindHistory = (reason: RewindClearReason) => {
    origin = null;
    frames = [];
    nextFrameIndex = 0;
    rewindError = null;
    journal.clear();
    options.onHistoryCleared?.(reason);
  };

  const disposeJournalCapture = installJournalCapture(
    runtime as import("./execution-rewind-journal-capture.js").JournalCaptureRuntimeLike,
    journal,
  );

  const onProjectStart = () => {
    if (isReplaying) return;
    clearRewindHistory("green-flag");
    const captured = options.captureOrigin?.() ?? null;
    if (captured) {
      origin = cloneOrigin(captured);
    }
    nextFrameIndex = 0;
  };
  runtime.on?.("PROJECT_START", onProjectStart);

  runtime._step = (...args: unknown[]) => {
    if (disposed) return innerStep(...args);

    if (isReplaying || journal.getMode() === "replay") {
      return innerStep(...args);
    }

    const journalStart = journal.size;
    journal.beginRecord();
    let result: unknown;
    try {
      result = innerStep(...args);
    } finally {
      journal.endFrame();
    }
    const journalEnd = journal.size;

    if (!origin) {
      return result;
    }

    if (journal.exceedsByteLimit()) {
      clearRewindHistory("journal-limit");
      rewindError = "この実行は正確に巻き戻せません";
      return result;
    }

    const frameIndex = nextFrameIndex;
    nextFrameIndex += 1;
    const fingerprint = computeFrameFingerprint({
      frameIndex,
      runtime,
      blockGraphHash: origin.blockGraphHash,
    });
    frames.push({
      frameIndex,
      traceSize: options.getTraceSize?.() ?? 0,
      journalStart,
      journalEnd,
      fingerprint,
    });

    if (frames.length > maxFrames) {
      clearRewindHistory("frame-limit");
      rewindError = "この実行は正確に巻き戻せません";
    }

    return result;
  };
  runtime[REWIND_FLAG] = true;

  const handle: ExecutionRewindHandle = {
    getSnapshot(): RewindSnapshot {
      const rewindDepth = frames.length > 0 ? frames.length - 1 : 0;
      return {
        canRewind: rewindDepth > 0 && rewindError === null && !isReplaying,
        rewindDepth,
        isReplaying,
        rewindError,
      };
    },
    clearRewindHistory(reason: RewindClearReason) {
      clearRewindHistory(reason);
    },
    async replayToFrame(targetFrameIndex: number): Promise<ReplayResult> {
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

      isReplaying = true;
      try {
        const result = await replayToFrame({
          origin,
          frames,
          journal,
          targetFrameIndex,
          runtime,
          step: () => innerStep(),
          restoreOrigin: options.restoreOrigin,
          getTraceSize: options.getTraceSize,
        });
        if (!result.ok) {
          rewindError = "この実行は正確に巻き戻せません";
        }
        return result;
      } finally {
        isReplaying = false;
      }
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
      disposeJournalCapture();
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
  computeFrameFingerprint,
  computeProjectBlockGraphHash,
  RewindJournal,
  replayToFrame,
};
