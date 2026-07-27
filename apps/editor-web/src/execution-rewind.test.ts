import {describe, expect, it, vi} from "vitest";
import {
  computeFrameFingerprint,
  computeProjectBlockGraphHash,
} from "./execution-rewind-fingerprint.js";
import {
  RewindJournal,
  RewindJournalMismatchError,
} from "./execution-rewind-journal.js";
import {installJournalCapture} from "./execution-rewind-journal-capture.js";
import {replayToFrame} from "./execution-rewind-replay.js";
import {stableTargetIdentity} from "./execution-rewind-target-identity.js";
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
  isStage?: boolean;
  layerOrder?: number;
  getName: () => string;
  x: number;
  y: number;
  direction: number;
  size: number;
  visible: boolean;
  currentCostume: number;
  variables: Record<string, unknown>;
  blocks: {_blocks: Record<string, unknown>};
};

function makeSimulatedRuntime(seedValues: number[]) {
  let seedIndex = 0;
  let currentMSecs = 1_000;
  const target: SimTarget = {
    id: "sprite1",
    layerOrder: 1,
    getName: () => "ネコ",
    x: 0,
    y: 0,
    direction: 90,
    size: 100,
    visible: true,
    currentCostume: 0,
    variables: {},
    blocks: {_blocks: {}},
  };
  const thread = {
    topBlock: "hat",
    blockGlowInFrame: "move",
    status: 0,
    stack: ["move"],
    stackFrames: [{warpMode: false, loop: false, params: null}],
    target,
    peekStack: () => "move",
  };

  const operatorRandom = vi.fn(() => {
    const value = seedValues[seedIndex] ?? 1;
    seedIndex += 1;
    return value;
  });

  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const runtime = {
    currentMSecs,
    threads: [thread],
    targets: [target],
    ioDevices: {
      clock: {
        projectTimer: () => seedIndex * 0.01,
      },
      mouse: {
        getScratchX: () => 10,
        getScratchY: () => -20,
        getIsDown: () => false,
      },
    },
    updateCurrentMSecs() {
      currentMSecs += 1;
      runtime.currentMSecs = currentMSecs;
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
    runtime.updateCurrentMSecs();
    runtime.ioDevices.clock.projectTimer();
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
    currentMSecs = 1_000;
    runtime.currentMSecs = currentMSecs;
    target.id = `sprite-${Math.random().toString(16).slice(2, 8)}`;
    target.x = 0;
    target.y = 0;
    target.direction = 90;
    target.variables = {};
    thread.blockGlowInFrame = "move";
    thread.stack = ["move"];
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

describe("stableTargetIdentity", () => {
  it("ignores runtime target id", () => {
    const a = stableTargetIdentity({
      id: "aaa",
      getName: () => "ネコ",
      layerOrder: 1,
    });
    const b = stableTargetIdentity({
      id: "bbb",
      getName: () => "ネコ",
      layerOrder: 1,
    });
    expect(a).toBe(b);
  });
});

describe("RewindJournal", () => {
  it("records and replays random entries in order", () => {
    const journal = new RewindJournal();
    journal.beginRecord();
    journal.append({kind: "random", from: 1, to: 10, value: 4});
    journal.append({kind: "random", from: 1, to: 10, value: 7});
    journal.endFrame();
    expect(journal.getMode()).toBe("idle");

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
    expect(journal.replayRangeFullyConsumed()).toBe(true);
  });

  it("throws when replay kind does not match", () => {
    const journal = new RewindJournal();
    journal.beginRecord();
    journal.append({kind: "clock", projectTimer: 0, currentMSecs: 100});
    journal.endFrame();
    journal.beginReplay(0, 1);
    expect(() => journal.consume("random")).toThrow(RewindJournalMismatchError);
  });

  it("detects unconsumed replay ranges", () => {
    const journal = new RewindJournal();
    journal.beginRecord();
    journal.append({kind: "random", from: 1, to: 10, value: 1});
    journal.append({kind: "random", from: 1, to: 10, value: 2});
    journal.endFrame();
    journal.beginReplay(0, 2);
    journal.consume("random");
    expect(journal.replayRangeFullyConsumed()).toBe(false);
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

  it("includes stack and stackFrames", () => {
    const {runtime} = makeSimulatedRuntime([]);
    const origin = makeOrigin(runtime);
    const before = computeFrameFingerprint({
      frameIndex: 0,
      runtime,
      blockGraphHash: origin.blockGraphHash,
    });
    runtime.threads![0]!.stack = ["a", "b"];
    const after = computeFrameFingerprint({
      frameIndex: 0,
      runtime,
      blockGraphHash: origin.blockGraphHash,
    });
    expect(before).not.toEqual(after);
  });

  it("hashes visible block graphs with stable target identity", () => {
    const {runtime} = makeSimulatedRuntime([]);
    expect(computeProjectBlockGraphHash(runtime)).toBe("sprite:ネコ:1:orig=0");
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

    expect(
      journal.slice(0, journal.size).filter(entry => entry.kind === "random"),
    ).toEqual([
      {kind: "random", from: 1, to: 10, value: 5},
      {kind: "random", from: 1, to: 10, value: 2},
    ]);
  });

  it("records projectTimer and currentMSecs", () => {
    const journal = new RewindJournal();
    const {runtime} = makeSimulatedRuntime([]);
    const dispose = installJournalCapture(runtime, journal);
    journal.beginRecord();
    runtime._step!();
    journal.endFrame();
    dispose();

    expect(journal.slice(0, journal.size).some(entry => entry.kind === "clock")).toBe(
      true,
    );
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
    expect(handle.getSnapshot().rewindDepth).toBe(2);
    handle.dispose();
  });

  it("does not clear history on PROJECT_START while replaying", async () => {
    const {runtime, resetToOrigin} = makeSimulatedRuntime([2, 4]);
    const journal = new RewindJournal();
    const handle = installExecutionRewind(
      {runtime},
      {
        journal,
        captureOrigin: () => makeOrigin(runtime),
        restoreOrigin: async () => {
          resetToOrigin();
        },
      },
    )!;

    runtime.fire("PROJECT_START");
    runtime._step!();
    runtime._step!();
    expect(handle.getFrames()).toHaveLength(2);

    await handle.replayToFrame(1);
    expect(handle.getFrames()).toHaveLength(2);
    handle.dispose();
  });

  it("returns the same handle when installed twice", () => {
    const {runtime} = makeSimulatedRuntime([]);
    const first = installExecutionRewind({runtime})!;
    const second = installExecutionRewind({runtime})!;
    expect(first).toBe(second);
    first.dispose();
  });
});

describe("replayToFrame", () => {
  it("deterministically reaches the same scheduler frame", async () => {
    const sim = makeSimulatedRuntime([3, 5, 2]);
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
    sim.runtime._step!();

    const frames = handle.getFrames();
    const result = await handle.replayToFrame(1);
    expect(result.ok).toBe(true);
    expect(sim.target.x).toBe(8);
    expect(frames[1]!.fingerprint).toBe(result.actualFingerprint);
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
    const corrupted = journal.cloneEntries();
    const randomIndex = corrupted.findIndex(entry => entry.kind === "random");
    if (randomIndex >= 0) {
      corrupted[randomIndex] = {
        kind: "random",
        from: 1,
        to: 10,
        value: 999,
      };
    }
    journal.restoreEntries(corrupted);

    const result = await replayToFrame({
      origin,
      frames,
      journal,
      targetFrameIndex: 1,
      runtime: sim.runtime,
      step: () => sim.runtime._step!(),
      restoreOrigin: async () => {
        sim.resetToOrigin();
      },
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Fingerprint|journal|Mismatch/i);
    handle.dispose();
  });

  it("aborts when journal entries remain unconsumed", async () => {
    const sim = makeSimulatedRuntime([2]);
    const origin = makeOrigin(sim.runtime);
    const journal = new RewindJournal();
    const handle = installExecutionRewind(
      {runtime: sim.runtime},
      {
        captureOrigin: () => origin,
        restoreOrigin: async () => sim.resetToOrigin(),
        journal,
      },
    )!;

    sim.runtime.fire("PROJECT_START");
    sim.runtime._step!();
    const frames = handle.getFrames().map(frame => ({
      ...frame,
      journalEnd: frame.journalEnd + 1,
    }));

    const result = await replayToFrame({
      origin,
      frames,
      journal,
      targetFrameIndex: 0,
      runtime: sim.runtime,
      step: () => sim.runtime._step!(),
      restoreOrigin: async () => sim.resetToOrigin(),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not fully consumed/i);
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
        restoreOrigin: async () => sim.resetToOrigin(),
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
      step: () => sim.runtime._step!(),
      restoreOrigin: async () => sim.resetToOrigin(),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Fingerprint/i);
    handle.dispose();
  });
});

describe("wrapper order with execution trace and control", () => {
  it("records frames only when _step actually runs", () => {
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
