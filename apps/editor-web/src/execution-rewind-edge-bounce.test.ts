import {describe, expect, it, vi} from "vitest";
import {RewindJournal} from "./execution-rewind-journal.js";
import {installEdgeBounceCapture} from "./execution-rewind-edge-bounce.js";

describe("installEdgeBounceCapture", () => {
  it("records and replays edge bounce without calling getBounds", () => {
    const journal = new RewindJournal();
    const target = {
      direction: 90,
      x: -230,
      y: 0,
      setDirection(direction: number) {
        this.direction = direction;
      },
      setXY(x: number, y: number) {
        this.x = x;
        this.y = y;
      },
    };

    const original = vi.fn((_args: unknown, util: {target: typeof target}) => {
      util.target.setDirection(-90);
      util.target.setXY(-220, 0);
    });

    const runtime: {
      getOpcodeFunction: (opcode: string) => unknown;
    } = {
      getOpcodeFunction(opcode: string) {
        if (opcode === "motion_ifonedgebounce") return original;
        return undefined;
      },
    };

    const dispose = installEdgeBounceCapture({runtime, journal});

    journal.beginRecord();
    const recordFn = runtime.getOpcodeFunction("motion_ifonedgebounce") as (
      args: unknown,
      util: {target: typeof target},
    ) => void;
    recordFn({}, {target});
    journal.endFrame();

    expect(original).toHaveBeenCalledTimes(1);
    expect(journal.slice(0, journal.size)[0]).toEqual({
      kind: "edgeBounce",
      applied: true,
      direction: -90,
      x: -220,
      y: 0,
    });

    target.direction = 90;
    target.x = -230;
    target.y = 0;
    original.mockClear();

    journal.beginReplay(0, journal.size);
    const replayFn = runtime.getOpcodeFunction("motion_ifonedgebounce") as (
      args: unknown,
      util: {target: typeof target},
    ) => void;
    replayFn({}, {target});
    journal.endFrame();

    expect(original).not.toHaveBeenCalled();
    expect(target.direction).toBe(-90);
    expect(target.x).toBe(-220);
    expect(target.y).toBe(0);

    dispose();
  });

  it("records a no-op when bounce does not change target state", () => {
    const journal = new RewindJournal();
    const target = {
      direction: 90,
      x: 0,
      y: 0,
      setDirection(direction: number) {
        this.direction = direction;
      },
      setXY(x: number, y: number) {
        this.x = x;
        this.y = y;
      },
    };

    const original = vi.fn();

    const runtime = {
      getOpcodeFunction(opcode: string) {
        if (opcode === "motion_ifonedgebounce") return original;
        return undefined;
      },
    };

    installEdgeBounceCapture({runtime, journal});

    journal.beginRecord();
    const recordFn = runtime.getOpcodeFunction("motion_ifonedgebounce") as (
      args: unknown,
      util: {target: typeof target},
    ) => void;
    recordFn({}, {target});
    journal.endFrame();

    expect(journal.slice(0, journal.size)[0]).toEqual({
      kind: "edgeBounce",
      applied: false,
      direction: 90,
      x: 0,
      y: 0,
    });
  });
});
