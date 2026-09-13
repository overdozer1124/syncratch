import {
  computeFrameFingerprint,
  type RewindRuntimeLike,
} from "./execution-rewind-fingerprint.js";
import type {CloneOrderRegistry} from "./execution-rewind-clone-order.js";
import {
  flushReplayPromiseDeferreds,
} from "./execution-rewind-promise-resolve.js";
import {
  RewindJournal,
  RewindJournalMismatchError,
  RewindJournalUnconsumedError,
} from "./execution-rewind-journal.js";
import {restartGreenFlagHatThreads} from "./execution-rewind-green-flag.js";
import {bindCloneOrderRegistry} from "./execution-rewind-target-identity.js";
import type {
  ReplayResult,
  RewindFrame,
  RewindOrigin,
} from "./execution-rewind-types.js";

export type ReplayRuntimeLike = RewindRuntimeLike;

export interface ReplayToFrameOptions {
  origin: RewindOrigin;
  frames: RewindFrame[];
  journal: RewindJournal;
  targetFrameIndex: number;
  runtime: ReplayRuntimeLike;
  cloneOrderRegistry?: CloneOrderRegistry;
  /** Scheduler step inside the pause gate (trace/rewind inner `_step`). */
  step: () => unknown;
  restoreOrigin: (origin: RewindOrigin) => Promise<void>;
  getTraceSize?: () => number;
  onRestored?: () => void;
}

async function restoreRewindOriginState(
  origin: RewindOrigin,
  restoreOrigin: (origin: RewindOrigin) => Promise<void>,
  runtime: ReplayRuntimeLike,
  cloneOrderRegistry?: CloneOrderRegistry,
): Promise<void> {
  await restoreOrigin(origin);
  cloneOrderRegistry?.reset();
  cloneOrderRegistry?.seedOriginalTargets(runtime.targets);
  bindCloneOrderRegistry(cloneOrderRegistry ?? null);
  restartGreenFlagHatThreads(
    runtime as import("./execution-rewind-green-flag.js").GreenFlagRuntimeLike,
  );
}

function validateTargetFrame(
  frames: RewindFrame[],
  targetFrameIndex: number,
): RewindFrame | null {
  if (targetFrameIndex < 0) return null;
  return frames.find(frame => frame.frameIndex === targetFrameIndex) ?? null;
}

function assertReplayRangeConsumed(
  journal: RewindJournal,
  frameIndex: number,
): void {
  if (!journal.replayRangeFullyConsumed()) {
    throw new RewindJournalUnconsumedError(
      `Journal replay range not fully consumed at frame ${frameIndex}`,
    );
  }
}

/**
 * Deterministically replay scheduler frames from `RewindOrigin` up to
 * `targetFrameIndex`, verifying the recorded fingerprint at the destination.
 */
export async function replayToFrame(
  options: ReplayToFrameOptions,
): Promise<ReplayResult> {
  const {
    origin,
    frames,
    journal,
    targetFrameIndex,
    runtime,
    cloneOrderRegistry,
    step,
    restoreOrigin,
    onRestored,
  } = options;

  const expected = validateTargetFrame(frames, targetFrameIndex);
  if (!expected) {
    return {
      ok: false,
      targetFrameIndex,
      expectedFingerprint: null,
      actualFingerprint: null,
      error: `Frame ${targetFrameIndex} was not recorded`,
    };
  }

  try {
    await restoreRewindOriginState(
      origin,
      restoreOrigin,
      runtime,
      cloneOrderRegistry,
    );
    onRestored?.();
  } catch (error) {
    return {
      ok: false,
      targetFrameIndex,
      expectedFingerprint: expected.fingerprint,
      actualFingerprint: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    for (let index = 0; index <= targetFrameIndex; index += 1) {
      const frame = frames[index];
      if (!frame || frame.frameIndex !== index) {
        return {
          ok: false,
          targetFrameIndex,
          expectedFingerprint: expected.fingerprint,
          actualFingerprint: null,
          error: `Missing recorded frame ${index}`,
        };
      }

      journal.beginReplay(frame.journalStart, frame.journalEnd);
      try {
        step();
        flushReplayPromiseDeferreds(journal);
      } finally {
        journal.endFrame();
      }
      try {
        assertReplayRangeConsumed(journal, index);
      } catch (error) {
        return {
          ok: false,
          targetFrameIndex,
          expectedFingerprint: frame.fingerprint,
          actualFingerprint: computeFrameFingerprint({
            frameIndex: index,
            runtime,
            blockGraphHash: origin.blockGraphHash,
          }).fingerprint,
          error: error instanceof Error ? error.message : String(error),
        };
      }

      const actualFingerprint = computeFrameFingerprint({
        frameIndex: index,
        runtime,
        blockGraphHash: origin.blockGraphHash,
      });

      if (!actualFingerprint.supported) {
        return {
          ok: false,
          targetFrameIndex,
          expectedFingerprint: frame.fingerprint,
          actualFingerprint: actualFingerprint.fingerprint,
          error:
            actualFingerprint.unsupportedReason ??
            "Stack frame state could not be normalized for rewind",
        };
      }

      if (actualFingerprint.fingerprint !== frame.fingerprint) {
        return {
          ok: false,
          targetFrameIndex,
          expectedFingerprint: frame.fingerprint,
          actualFingerprint: actualFingerprint.fingerprint,
          error: `Fingerprint mismatch at frame ${index}`,
        };
      }
    }

    const finalFingerprint = computeFrameFingerprint({
      frameIndex: targetFrameIndex,
      runtime,
      blockGraphHash: origin.blockGraphHash,
    });

    return {
      ok:
        finalFingerprint.supported &&
        finalFingerprint.fingerprint === expected.fingerprint,
      targetFrameIndex,
      expectedFingerprint: expected.fingerprint,
      actualFingerprint: finalFingerprint.fingerprint,
      error:
        !finalFingerprint.supported
          ? finalFingerprint.unsupportedReason ??
            "Stack frame state could not be normalized for rewind"
          : finalFingerprint.fingerprint === expected.fingerprint
            ? null
            : "Destination fingerprint mismatch",
    };
  } catch (error) {
    const message =
      error instanceof RewindJournalMismatchError ||
      error instanceof RewindJournalUnconsumedError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    return {
      ok: false,
      targetFrameIndex,
      expectedFingerprint: expected.fingerprint,
      actualFingerprint: computeFrameFingerprint({
        frameIndex: targetFrameIndex,
        runtime,
        blockGraphHash: origin.blockGraphHash,
      }).fingerprint,
      error: message,
    };
  } finally {
    journal.endFrame();
  }
}

export function truncateFramesAfter(
  frames: RewindFrame[],
  frameIndex: number,
): RewindFrame[] {
  return frames.filter(frame => frame.frameIndex <= frameIndex);
}
