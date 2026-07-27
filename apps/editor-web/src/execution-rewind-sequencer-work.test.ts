import {describe, expect, it} from "vitest";
import {RewindJournal} from "./execution-rewind-journal.js";
import {installSequencerWorkCapture} from "./execution-rewind-sequencer-work.js";

describe("installSequencerWorkCapture", () => {
  it("records and replays sequencer inner loop counts", () => {
    const journal = new RewindJournal();
    const realTimer = {
      started: false,
      checks: 0,
      start() {
        this.started = true;
        this.checks = 0;
      },
      timeElapsed() {
        this.checks += 1;
        return this.checks >= 3 ? 16 : 1;
      },
    };
    const runtime = {
      currentStepTime: 20,
      sequencer: {
        timer: realTimer,
        stepThreads() {
          runtime.sequencer.timer.start();
          let loops = 0;
          while (runtime.sequencer.timer.timeElapsed() < 15) {
            loops += 1;
          }
          return loops;
        },
      },
    };

    const dispose = installSequencerWorkCapture({runtime, journal});

    journal.beginRecord();
    runtime.sequencer.stepThreads();
    journal.endFrame();
    expect(journal.slice(0, journal.size)).toEqual([
      {kind: "sequencerWork", innerLoops: 3, lastElapsed: 16},
    ]);

    journal.beginReplay(0, 1);
    const replayLoops = runtime.sequencer.stepThreads();
    journal.endFrame();
    expect(replayLoops).toBe(2);
    expect(journal.replayRangeFullyConsumed()).toBe(true);

    dispose();
  });
});
