import {
  computeFrameFingerprint,
  type RewindRuntimeLike,
} from "./execution-rewind-fingerprint.js";
import {RewindJournal, RewindJournalMismatchError} from "./execution-rewind-journal.js";
import type {
  ReplayResult,
  RewindFrame,
  RewindOrigin,
} from "./execution-rewind-types.js";

export type ReplayRuntimeLike = RewindRuntimeLike & {
  _step?: (...args: unknown[]) => unknown;
};

export interface ReplayToFrameOptions {
  origin: RewindOrigin;
  frames: RewindFrame[];
  journal: RewindJournal;
  targetFrameIndex: number;
  runtime: ReplayRuntimeLike;
  restoreOrigin: (origin: RewindOrigin) => Promise<void>;
  getTraceSize?: () => number;
}

function validateTargetFrame(
  frames: RewindFrame[],
  targetFrameIndex: number,
): RewindFrame | null {
  if (targetFrameIndex < 0) return null;
  return frames.find(frame => frame.frameIndex === targetFrameIndex) ?? null;
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
    restoreOrigin,
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

  if (typeof runtime._step !== "function") {
    return {
      ok: false,
      targetFrameIndex,
      expectedFingerprint: expected.fingerprint,
      actualFingerprint: null,
      error: "Runtime._step is unavailable",
    };
  }

  const step = runtime._step.bind(runtime);

  try {
    await restoreOrigin(origin);
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
      const frame = frames.find(entry => entry.frameIndex === index);
      if (!frame) {
        return {
          ok: false,
          targetFrameIndex,
          expectedFingerprint: expected.fingerprint,
          actualFingerprint: null,
          error: `Missing recorded frame ${index}`,
        };
      }

      journal.beginReplay(frame.journalStart, frame.journalEnd);
      step();
      journal.endFrame();

      const actualFingerprint = computeFrameFingerprint({
        frameIndex: index,
        runtime,
        blockGraphHash: origin.blockGraphHash,
      });

      if (actualFingerprint !== frame.fingerprint) {
        return {
          ok: false,
          targetFrameIndex,
          expectedFingerprint: frame.fingerprint,
          actualFingerprint,
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
      ok: finalFingerprint === expected.fingerprint,
      targetFrameIndex,
      expectedFingerprint: expected.fingerprint,
      actualFingerprint: finalFingerprint,
      error:
        finalFingerprint === expected.fingerprint
          ? null
          : "Destination fingerprint mismatch",
    };
  } catch (error) {
    const message =
      error instanceof RewindJournalMismatchError
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
      }),
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
