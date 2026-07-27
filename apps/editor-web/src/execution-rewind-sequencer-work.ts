import type {JournalEntry} from "./execution-rewind-types.js";
import type {RewindJournal} from "./execution-rewind-journal.js";
import {RewindJournalMismatchError} from "./execution-rewind-journal.js";

type SequencerWorkJournalEntry = Extract<
  JournalEntry,
  {kind: "sequencerWork"}
>;

export type SequencerWorkRuntimeLike = {
  currentStepTime?: number;
  sequencer?: {
    timer: {start: () => void; timeElapsed: () => number};
    stepThreads: () => unknown;
    __syncratchRewindOriginalStepThreads?: () => unknown;
  };
};

const SEQUENCER_WORK_FLAG = "__syncratchRewindSequencerWorkInstalled";

function workTimeBudget(runtime: SequencerWorkRuntimeLike): number {
  return 0.75 * (runtime.currentStepTime ?? 15);
}

function createReplayTimer(
  realTimer: {start: () => void; timeElapsed: () => number},
  entry: SequencerWorkJournalEntry,
  workTime: number,
): {start: () => void; timeElapsed: () => number} {
  let checks = 0;
  return {
    start() {
      checks = 0;
      realTimer.start();
    },
    timeElapsed() {
      checks += 1;
      if (checks < entry.innerLoops) {
        return 0;
      }
      if (checks === entry.innerLoops) {
        return entry.lastElapsed;
      }
      return workTime + 1;
    },
  };
}

function findRemainingReplayEntry(
  journal: RewindJournal,
  kind: SequencerWorkJournalEntry["kind"],
): SequencerWorkJournalEntry | null {
  for (
    let index = journal.getReplayCursor();
    index < journal.getReplayEnd();
    index += 1
  ) {
    const entry = journal.slice(index, index + 1)[0];
    if (entry?.kind === kind) {
      return entry as SequencerWorkJournalEntry;
    }
  }
  return null;
}

/** Journal scratch-vm sequencer inner-loop counts for deterministic forever/turbo frames. */
export function installSequencerWorkCapture(input: {
  runtime: SequencerWorkRuntimeLike;
  journal: RewindJournal;
}): () => void {
  const {runtime, journal} = input;
  const sequencer = runtime.sequencer;
  if (!sequencer || sequencer.__syncratchRewindOriginalStepThreads) {
    return () => undefined;
  }

  const realTimer = sequencer.timer;
  const originalStepThreads = sequencer.stepThreads.bind(sequencer);
  sequencer.__syncratchRewindOriginalStepThreads = originalStepThreads;

  sequencer.stepThreads = () => {
    const mode = journal.getMode();
    const workTime = workTimeBudget(runtime);

    if (mode === "replay") {
      const entry = findRemainingReplayEntry(journal, "sequencerWork");
      if (!entry) {
        throw new RewindJournalMismatchError(
          "Expected sequencerWork journal entry",
        );
      }
      sequencer.timer = createReplayTimer(realTimer, entry, workTime);
      try {
        return originalStepThreads();
      } finally {
        sequencer.timer = realTimer;
        if (journal.peekReplayEntry()?.kind === "sequencerWork") {
          journal.consume("sequencerWork");
        }
      }
    }

    if (mode === "record") {
      let innerLoops = 0;
      let lastElapsed = 0;
      sequencer.timer = {
        start() {
          innerLoops = 0;
          lastElapsed = 0;
          realTimer.start();
        },
        timeElapsed() {
          innerLoops += 1;
          lastElapsed = realTimer.timeElapsed();
          return lastElapsed;
        },
      };
      try {
        const result = originalStepThreads();
        journal.append({kind: "sequencerWork", innerLoops, lastElapsed});
        return result;
      } finally {
        sequencer.timer = realTimer;
      }
    }

    return originalStepThreads();
  };

  (runtime as Record<string, unknown>)[SEQUENCER_WORK_FLAG] = true;

  return () => {
    if (sequencer.__syncratchRewindOriginalStepThreads) {
      sequencer.stepThreads = sequencer.__syncratchRewindOriginalStepThreads;
      delete sequencer.__syncratchRewindOriginalStepThreads;
    }
    sequencer.timer = realTimer;
    (runtime as Record<string, unknown>)[SEQUENCER_WORK_FLAG] = false;
  };
}
