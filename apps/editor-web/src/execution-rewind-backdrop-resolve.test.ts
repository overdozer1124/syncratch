import {describe, expect, it, vi} from "vitest";
import {RewindJournal} from "./execution-rewind-journal.js";
import {installBackdropResolveCapture} from "./execution-rewind-backdrop-resolve.js";

describe("installBackdropResolveCapture", () => {
  it("records resolved random backdrop names during record", () => {
    const journal = new RewindJournal();
    const stage = {
      currentCostume: 2,
      getCostumes: () => [{name: "A"}, {name: "B"}, {name: "C"}],
    };
    const original = vi.fn((_args: unknown, util?: {runtime?: unknown}) => {
      void util;
      return 1;
    });
    const runtime = {
      getTargetForStage: () => stage,
      getOpcodeFunction: (opcode: string) =>
        opcode === "looks_switchbackdrop" ? original : undefined,
    };
    const dispose = installBackdropResolveCapture({runtime, journal});
    journal.beginRecord();
    const fn = runtime.getOpcodeFunction("looks_switchbackdrop") as
      | ((args: unknown, util?: unknown) => unknown)
      | undefined;
    fn?.({BACKDROP: "random backdrop"}, {runtime});
    journal.endFrame();
    dispose();

    expect(journal.slice(0, journal.size)).toEqual([
      {
        kind: "backdropResolve",
        requested: "random backdrop",
        backdropName: "C",
        costumeIndex: 2,
      },
    ]);
    expect(original).toHaveBeenCalledTimes(1);
  });

  it("replays random backdrop using the journaled costume name", () => {
    const journal = new RewindJournal();
    journal.beginRecord();
    journal.append({
      kind: "backdropResolve",
      requested: "random backdrop",
      backdropName: "Blue Sky",
      costumeIndex: 1,
    });
    journal.endFrame();

    const original = vi.fn(() => 1);
    const runtime = {
      getTargetForStage: () => ({
        currentCostume: 0,
        getCostumes: () => [{name: "A"}, {name: "Blue Sky"}],
      }),
      getOpcodeFunction: (opcode: string) =>
        opcode === "looks_switchbackdroptoandwait" ? original : undefined,
    };
    const dispose = installBackdropResolveCapture({runtime, journal});
    journal.beginReplay(0, 1);
    const fn = runtime.getOpcodeFunction(
      "looks_switchbackdroptoandwait",
    ) as ((args: unknown) => unknown) | undefined;
    fn?.({BACKDROP: "random backdrop"});
    journal.endFrame();
    dispose();

    expect(original).toHaveBeenCalledWith(
      {BACKDROP: "Blue Sky"},
      undefined,
    );
  });
});
