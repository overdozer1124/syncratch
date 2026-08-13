import {describe, expect, it} from "vitest";
import {RewindJournal} from "./execution-rewind-journal.js";
import {installSpriteXYCapture} from "./execution-rewind-sprite-xy.js";

describe("installSpriteXYCapture", () => {
  it("does not journal setXY calls that keep the requested coordinates", () => {
    const journal = new RewindJournal();
    const target = {
      x: 0,
      y: 0,
      setXY(x: number, y: number) {
        this.x = x;
        this.y = y;
      },
    };
    const runtime = {targets: [target]};
    const capture = installSpriteXYCapture({runtime, journal});

    journal.beginRecord();
    target.setXY(10, 4);
    journal.endFrame();

    expect(target.x).toBe(10);
    expect(journal.size).toBe(0);

    capture.dispose();
  });

  it("replays recorded setXY coordinates onto a new unfenced target", () => {
    const journal = new RewindJournal();
    const recordTarget = {
      x: 0,
      y: 0,
      setXY(x: number, y: number) {
        this.x = Math.min(x, 200);
        this.y = y;
      },
    };
    const runtime = {targets: [recordTarget]};
    const capture = installSpriteXYCapture({runtime, journal});

    journal.beginRecord();
    recordTarget.setXY(250, 0);
    journal.endFrame();
    expect(recordTarget.x).toBe(200);
    expect(journal.slice(0, journal.size)).toEqual([
      {kind: "spriteXY", x: 200, y: 0},
    ]);

    const replayTarget = {
      x: 0,
      y: 0,
      setXY(x: number, y: number) {
        this.x = x;
        this.y = y;
      },
    };
    runtime.targets = [replayTarget];
    capture.ensureWrapped();

    journal.beginReplay(0, 1);
    replayTarget.setXY(999, 0);
    journal.endFrame();
    expect(replayTarget.x).toBe(200);
    expect(journal.replayRangeFullyConsumed()).toBe(true);

    capture.dispose();
  });

  it("does not wrap the stage, so idle setXY stays unjournaled", () => {
    const journal = new RewindJournal();
    const stage = {
      isStage: true,
      x: 0,
      y: 0,
      setXY(x: number, y: number) {
        this.x = x;
        this.y = y;
      },
    };
    const capture = installSpriteXYCapture({
      runtime: {targets: [stage]},
      journal,
    });

    journal.beginRecord();
    stage.setXY(12, 8);
    journal.endFrame();
    expect(journal.size).toBe(0);

    capture.dispose();
  });

  it("keeps x座標 > 240 false on replay when record was fenced below the threshold", () => {
    const journal = new RewindJournal();
    const recordTarget = {
      x: 0,
      y: 0,
      setXY(x: number, y: number) {
        this.x = Math.min(x, 200);
        this.y = y;
      },
    };
    const runtime = {targets: [recordTarget]};
    const capture = installSpriteXYCapture({runtime, journal});

    journal.beginRecord();
    recordTarget.setXY(250, 0);
    journal.endFrame();
    expect(recordTarget.x > 240).toBe(false);

    const replayTarget = {
      x: 0,
      y: 0,
      setXY(x: number, y: number) {
        this.x = x;
        this.y = y;
      },
    };
    runtime.targets = [replayTarget];
    capture.ensureWrapped();

    journal.beginReplay(0, 1);
    replayTarget.setXY(250, 0);
    journal.endFrame();
    expect(replayTarget.x).toBe(200);
    expect(replayTarget.x > 240).toBe(false);

    capture.dispose();
  });
});
