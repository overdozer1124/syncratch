import {describe, expect, it, vi} from "vitest";
import {
  computeFrameFingerprint,
  computeProjectBlockGraphHash,
} from "./execution-rewind-fingerprint.js";
import {RewindJournal, RewindJournalMismatchError} from "./execution-rewind-journal.js";
import {installJournalCapture} from "./execution-rewind-journal-capture.js";
import {replayToFrame} from "./execution-rewind-replay.js";
import {
  createRewindOrigin,
  installExecutionRewind,
  type RewindOrigin,
} from "./execution-rewind.js";
import type {ProjectDocument} from "@blocksync/project-schema";

function emptyDocument(): ProjectDocument {
  return {
    schemaVersion: 1,
    targets: [],
    monitors: [],
    extensions: [],
    meta: {},
  };
}

type SimTarget = {
  id: string;
  getName: () => string;
  x: number;
  y: number;
  direction: number;
  visible: boolean;
  variables: Record<string, unknown>;
  blocks: {_blocks: Record<string, unknown>};
};

function makeSimulatedRuntime(seedValues: number[]) {
  let seedIndex = 0;
  const target: SimTarget = {
    id: "sprite1",
    getName: () => "ネコ",
    x: 0,
    y: 0,
    direction: 90,
    visible: true,
    variables: {},
    blocks: {_blocks: {}},
  };
  const thread = {
    topBlock: "hat",
    blockGlowInFrame: "move",
    status: 0,
    target,
    peekStack: () => "move",
  };

  const operatorRandom = vi.fn((args: {FROM?: number; TO?: number}) => {
    const value = seedValues[seedIndex] ?? 1;
    seedIndex += 1;
    return value;
  });

  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const runtime = {
    threads: [thread],
    targets: [target],
    ioDevices: {
      clock: {
        projectTimer: () => 0,
        now: () => 1_000 + seedIndex,
      },
      mouse: {
        getScratchX: () => 10,
        getScratchY: () => -20,
        getIsDown: () => false,
      },
    },
    getOpcodeFunction: (opcode: string) =>
      opcode === "operator_random" ? operatorRandom : undefined,
    on: (event: string, handler: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    },
    off: (event: string, handler: (...args: unknown[]) => void) => {
      handlers.get(event)?.delete(handler);
    },
    fire: (event: string) => {
      for (const handler of handlers.get(event) ?? []) handler();
    },
    _step: undefined as undefined | (() => void),
  };

  runtime._step = () => {
    const random = runtime.getOpcodeFunction("operator_random") as (
      args: {FROM: number; TO: number},
    ) => number;
    const wrapped = random({FROM: 1, TO: 10});
    target.x += wrapped;
    target.variables.steps = wrapped;
    thread.blockGlowInFrame = `move-${target.x}`;
  };

  const resetToOrigin = () => {
    seedIndex = 0;
    target.x = 0;
    target.y = 0;
    target.direction = 90;
    target.variables = {};
    thread.blockGlowInFrame = "move";
  };

  return {runtime, target, thread, resetToOrigin, operatorRandom};
}

function makeOrigin(runtime: ReturnType<typeof makeSimulatedRuntime>["runtime"]): RewindOrigin {
  return createRewindOrigin({
    document: emptyDocument(),
    assets: new Map(),
    projectSessionId: 1,
    runtime,
  });
}

describe("RewindJournal", () => {
  it("records and replays random entries in order", () => {
    const journal = new RewindJournal();
    journal.beginRecord();
    journal.append({kind: "random", from: 1, to: 10, value: 4});
    journal.append({kind: "random", from: 1, to: 10, value: 7});
    journal.endFrame();

    journal.beginReplay(0, 2);
    expect(journal.consume("random")).toEqual({
      kind: "random",
      from: 1,
      to: 10,
      value: 4,
    });
    expect(journal.consume("random")).toEqual({
      kind: "random",
      from: 1,
      to: 10,
      value: 7,
    });
    journal.endFrame();
  });

  it("throws when replay kind does not match", () => {
    const journal = new RewindJournal();
    journal.beginRecord();
    journal.append({kind: "clock", projectTimer: 0, nowMs: 100});
    journal.endFrame();
    journal.beginReplay(0, 1);
    expect(() => journal.consume("random")).toThrow(RewindJournalMismatchError);
  });
});

describe("computeFrameFingerprint", () => {
  it("changes when target motion state changes", () => {
    const {runtime} = makeSimulatedRuntime([3]);
    const origin = makeOrigin(runtime);
    const before = computeFrameFingerprint({
      frameIndex: 0,
      runtime,
      blockGraphHash: origin.blockGraphHash,
    });
    runtime.targets![0]!.x = 5;
    const after = computeFrameFingerprint({
      frameIndex: 0,
      runtime,
      blockGraphHash: origin.blockGraphHash,
    });
    expect(before).not.toEqual(after);
  });

  it("hashes visible block graphs across targets", () => {
    const {runtime} = makeSimulatedRuntime([]);
    expect(computeProjectBlockGraphHash(runtime)).toBe("sprite1:orig:ネコ=0");
  });
});

describe("installJournalCapture", () => {
  it("records operator_random results during a frame", () => {
    const journal = new RewindJournal();
    const {runtime} = makeSimulatedRuntime([5, 2]);
    const dispose = installJournalCapture(runtime, journal);
    journal.beginRecord();
    runtime._step!();
    runtime._step!();
    journal.endFrame();
    dispose();

    expect(journal.slice(0, journal.size)).toEqual([
      {kind: "random", from: 1, to: 10, value: 5},
      {kind: "random", from: 1, to: 10, value: 2},
    ]);
  });

  it("replays recorded random values deterministically", () => {
    const journal = new RewindJournal();
    const {runtime, target, resetToOrigin} = makeSimulatedRuntime([8, 3]);
    const dispose = installJournalCapture(runtime, journal);

    journal.beginRecord();
    runtime._step!();
    runtime._step!();
    const recordedX = target.x;
    journal.endFrame();

    resetToOrigin();
    journal.beginReplay(0, 2);
    runtime._step!();
    runtime._step!();
    journal.endFrame();
    dispose();

    expect(target.x).toBe(recordedX);
  });
});

describe("installExecutionRewind", () => {
  it("records scheduler frames with fingerprints after PROJECT_START", () => {
    const {runtime} = makeSimulatedRuntime([2, 4, 6]);
    const origin = makeOrigin(runtime);
    const handle = installExecutionRewind(
      {runtime},
      {
        captureOrigin: () => origin,
        restoreOrigin: async () => undefined,
      },
    )!;

    runtime.fire("PROJECT_START");
    runtime._step!();
    runtime._step!();
    runtime._step!();

    const frames = handle.getFrames();
    expect(frames).toHaveLength(3);
    expect(frames.map(frame => frame.frameIndex)).toEqual([0, 1, 2]);
    expect(frames[0]!.journalEnd - frames[0]!.journalStart).toBeGreaterThan(0);
    expect(handle.getSnapshot().rewindDepth).toBe(2);
    handle.dispose();
  });

  it("clears history on PROJECT_START", () => {
    const {runtime} = makeSimulatedRuntime([1]);
    const handle = installExecutionRewind(
      {runtime},
      {captureOrigin: () => makeOrigin(runtime)},
    )!;
    runtime.fire("PROJECT_START");
    runtime._step!();
    expect(handle.getFrames()).toHaveLength(1);
    runtime.fire("PROJECT_START");
    runtime._step!();
    expect(handle.getFrames()).toHaveLength(1);
    expect(handle.getFrames()[0]!.frameIndex).toBe(0);
    handle.dispose();
  });
});

describe("replayToFrame", () => {
  it("deterministically reaches the same scheduler frame", async () => {
    const sim = makeSimulatedRuntime([3, 5, 2]);
    const origin = makeOrigin(sim.runtime);

    const handle = installExecutionRewind(
      {runtime: sim.runtime},
      {
        captureOrigin: () => origin,
        restoreOrigin: async () => {
          sim.resetToOrigin();
        },
      },
    )!;

    sim.runtime.fire("PROJECT_START");

    sim.runtime._step!();
    sim.runtime._step!();
    sim.runtime._step!();

    const frames = handle.getFrames();
    const frame1Fingerprint = frames[1]!.fingerprint;
    const expectedXAfterThreeSteps = sim.target.x;

    const result = await handle.replayToFrame(1);
    expect(result.ok).toBe(true);
    expect(result.expectedFingerprint).toBe(frame1Fingerprint);
    expect(result.actualFingerprint).toBe(frame1Fingerprint);
    expect(sim.target.x).toBe(8);

    sim.resetToOrigin();
    sim.runtime.fire("PROJECT_START");
    sim.runtime._step!();
    sim.runtime._step!();
    sim.runtime._step!();
    expect(sim.target.x).toBe(expectedXAfterThreeSteps);
    expect(
      computeFrameFingerprint({
        frameIndex: 2,
        runtime: sim.runtime,
        blockGraphHash: origin.blockGraphHash,
      }),
    ).toBe(frames[2]!.fingerprint);

    handle.dispose();
  });

  it("aborts when replay journal does not match", async () => {
    const sim = makeSimulatedRuntime([4, 1]);
    const origin = makeOrigin(sim.runtime);
    const journal = new RewindJournal();

    const handle = installExecutionRewind(
      {runtime: sim.runtime},
      {
        captureOrigin: () => origin,
        restoreOrigin: async () => {
          sim.resetToOrigin();
        },
        journal,
      },
    )!;

    sim.runtime.fire("PROJECT_START");
    sim.runtime._step!();
    sim.runtime._step!();

    const frames = handle.getFrames();
    journal.restoreEntries([
      {kind: "random", from: 1, to: 10, value: 999},
      {kind: "random", from: 1, to: 10, value: 999},
    ]);

    const result = await replayToFrame({
      origin,
      frames,
      journal,
      targetFrameIndex: 1,
      runtime: sim.runtime,
      restoreOrigin: async () => {
        sim.resetToOrigin();
      },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Fingerprint/i);
    handle.dispose();
  });

  it("aborts on fingerprint mismatch", async () => {
    const sim = makeSimulatedRuntime([2, 2]);
    const origin = makeOrigin(sim.runtime);
    const journal = new RewindJournal();

    const handle = installExecutionRewind(
      {runtime: sim.runtime},
      {
        captureOrigin: () => origin,
        restoreOrigin: async () => {
          sim.resetToOrigin();
        },
        journal,
      },
    )!;

    sim.runtime.fire("PROJECT_START");
    sim.runtime._step!();

    const frames = handle.getFrames().map(frame =>
      frame.frameIndex === 0 ? {...frame, fingerprint: "tampered"} : frame,
    );

    const result = await replayToFrame({
      origin,
      frames,
      journal,
      targetFrameIndex: 0,
      runtime: sim.runtime,
      restoreOrigin: async () => {
        sim.resetToOrigin();
      },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Fingerprint/i);
    handle.dispose();
  });

  it("clears history when frame limit is exceeded", () => {
    const sim = makeSimulatedRuntime(Array.from({length: 20}, (_, i) => i + 1));
    const handle = installExecutionRewind(
      {runtime: sim.runtime},
      {
        captureOrigin: () => makeOrigin(sim.runtime),
        maxFrames: 5,
      },
    )!;

    sim.runtime.fire("PROJECT_START");
    for (let i = 0; i < 6; i += 1) {
      sim.runtime._step!();
    }

    expect(handle.getFrames()).toHaveLength(0);
    expect(handle.getSnapshot().rewindError).toBe("この実行は正確に巻き戻せません");
    handle.dispose();
  });
});

describe("wrapper order with execution trace and control", () => {
  it("records frames only when _step actually runs", async () => {
    const sim = makeSimulatedRuntime([1, 2]);

    const rewind = installExecutionRewind(
      {runtime: sim.runtime},
      {captureOrigin: () => makeOrigin(sim.runtime)},
    )!;

    let paused = false;
    let framesToRun = 0;
    const innerStep = sim.runtime._step!;
    sim.runtime._step = (...args: unknown[]) => {
      if (paused) {
        if (framesToRun <= 0) return undefined;
        framesToRun -= 1;
      }
      return innerStep(...args);
    };

    sim.runtime.fire("PROJECT_START");

    paused = true;
    framesToRun = 0;
    sim.runtime._step!();
    expect(rewind.getFrames()).toHaveLength(0);

    framesToRun = 1;
    sim.runtime._step!();
    expect(rewind.getFrames()).toHaveLength(1);

    rewind.dispose();
  });
});
