import {describe, expect, it, vi} from "vitest";
import {
  CloneOrderRegistry,
} from "./execution-rewind-clone-order.js";
import {
  computeFrameFingerprint,
  computeProjectBlockGraphHash,
  normalizeStackFrame,
} from "./execution-rewind-fingerprint.js";
import {
  RewindJournal,
  RewindJournalMismatchError,
} from "./execution-rewind-journal.js";
import {installJournalCapture} from "./execution-rewind-journal-capture.js";
import {
  resolveNonDeterministicOpcode,
} from "./execution-rewind-non-deterministic.js";
import {replayToFrame} from "./execution-rewind-replay.js";
import {
  bindCloneOrderRegistry,
  stableTargetIdentity,
} from "./execution-rewind-target-identity.js";
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
  isOriginal?: boolean;
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
  const registry = new CloneOrderRegistry();
  bindCloneOrderRegistry(registry);

  const target: SimTarget = {
    id: "sprite1",
    isOriginal: true,
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
  registry.seedOriginalTargets([target]);

  const thread = {
    topBlock: "hat",
    blockGlowInFrame: "move",
    status: 0,
    stack: ["move"],
    stackFrames: [{
      warpMode: false,
      isLoop: false,
      params: null,
      executionContext: {loopCounter: 2},
      waitingReporter: null,
      justReported: null,
      reported: null,
    }],
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
    registry.reset();
    registry.seedOriginalTargets([target]);
    bindCloneOrderRegistry(registry);
  };

  return {runtime, target, thread, resetToOrigin, operatorRandom, registry};
}

function makeOrigin(
  runtime: ReturnType<typeof makeSimulatedRuntime>["runtime"],
  extensions: string[] = [],
): RewindOrigin {
  return createRewindOrigin({
    document: {...emptyDocument(), extensions},
    assets: new Map(),
    projectSessionId: 1,
    runtime,
    vmProjectJson: {extensions, targets: [], monitors: []},
  });
}

function installRewindWithExtensions(
  sim: ReturnType<typeof makeSimulatedRuntime>,
  extensions: string[] = [],
) {
  return installExecutionRewind(
    {runtime: sim.runtime},
    {
      captureOrigin: () => makeOrigin(sim.runtime, extensions),
      restoreOrigin: async () => sim.resetToOrigin(),
      cloneOrderRegistry: sim.registry,
    },
  )!;
}

function invokeOpcodeDuringRecord(
  runtime: ReturnType<typeof makeSimulatedRuntime>["runtime"],
  opcode: string,
  extensions: string[] = [],
) {
  runtime.getOpcodeFunction = (candidate: string) => {
    if (candidate === opcode) return () => 1;
    if (candidate === "operator_random") {
      return () => 1;
    }
    return undefined;
  };
  const journal = new RewindJournal();
  const unsupported = vi.fn();
  const dispose = installJournalCapture(runtime, journal, {
    getExtensionIds: () => extensions,
    onUnsupportedInput: unsupported,
  });
  journal.beginRecord();
  const fn = runtime.getOpcodeFunction(opcode) as (() => unknown) | undefined;
  fn?.();
  journal.endFrame();
  dispose();
  return unsupported;
}

describe("stableTargetIdentity", () => {
  it("ignores runtime target id", () => {
    const registry = new CloneOrderRegistry();
    bindCloneOrderRegistry(registry);
    const target = {
      id: "aaa",
      getName: () => "ネコ",
      isOriginal: true,
    };
    registry.seedOriginalTargets([target]);
    const a = stableTargetIdentity({...target, id: "aaa"});
    const b = stableTargetIdentity({...target, id: "bbb"});
    expect(a).toBe("sprite:ネコ:orig");
    expect(a).toBe(b);
  });

  it("distinguishes clones by creation order", () => {
    const registry = new CloneOrderRegistry();
    bindCloneOrderRegistry(registry);
    const original = {getName: () => "ネコ", isOriginal: true};
    registry.seedOriginalTargets([original]);
    const clone1 = {getName: () => "ネコ", isOriginal: false};
    const clone2 = {getName: () => "ネコ", isOriginal: false};
    registry.assignCloneOrder(clone1, original);
    registry.assignCloneOrder(clone2, original);
    expect(stableTargetIdentity(original)).toBe("sprite:ネコ:orig");
    expect(stableTargetIdentity(clone1)).toBe("sprite:ネコ:clone:1");
    expect(stableTargetIdentity(clone2)).toBe("sprite:ネコ:clone:2");
  });
});

describe("normalizeStackFrame", () => {
  it("uses isLoop and normalizes executionContext fields", () => {
    expect(
      normalizeStackFrame({
        warpMode: true,
        isLoop: true,
        params: {count: 1},
        executionContext: {loopCounter: 2},
        waitingReporter: "block-a",
        justReported: 5,
        reported: [{opCached: "block-a", inputValue: 5}],
      }),
    ).toEqual({
      warpMode: true,
      isLoop: true,
      params: {count: 1},
      executionContext: {loopCounter: 2},
      waitingReporter: "block-a",
      justReported: 5,
      reported: [{opCached: "block-a", inputValue: 5}],
    });
  });

  it("returns null for non-normalizable executionContext", () => {
    expect(
      normalizeStackFrame({
        executionContext: {callback: () => undefined},
      }),
    ).toBeNull();
  });

  it("normalizes wait timer executionContext without the Timer object", () => {
    const normalized = normalizeStackFrame({
      executionContext: {
        duration: 10,
        timer: {timeElapsed: () => 4},
      },
    });
    expect(normalized?.executionContext).toEqual({
      __waitTimer: {duration: 10, pending: true},
    });
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
    expect(before.fingerprint).not.toEqual(after.fingerprint);
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
    expect(before.fingerprint).not.toEqual(after.fingerprint);
  });

  it("marks unsupported frames when stack frames cannot be normalized", () => {
    const {runtime} = makeSimulatedRuntime([]);
    runtime.threads![0]!.stackFrames = [{
      executionContext: {fn: () => undefined},
    }];
    const result = computeFrameFingerprint({
      frameIndex: 0,
      runtime,
      blockGraphHash: "0",
    });
    expect(result.supported).toBe(false);
  });

  it("hashes visible block graphs with stable target identity", () => {
    const {runtime} = makeSimulatedRuntime([]);
    expect(computeProjectBlockGraphHash(runtime)).toBe("sprite:ネコ:orig=0");
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

  it("flags unsupported non-deterministic opcodes", () => {
    const {runtime} = makeSimulatedRuntime([]);
    const unsupported = invokeOpcodeDuringRecord(
      runtime,
      "sensing_loudness",
    );
    expect(resolveNonDeterministicOpcode("sensing_loudness", [])).toBe("loudness");
    expect(unsupported).toHaveBeenCalledWith({
      opcode: "sensing_loudness",
      journalKind: "loudness",
    });
  });
});

describe("unsupported non-deterministic opcode detection", () => {
  it.each([
    "sensing_current",
    "sensing_dayssince2000",
    "sensing_username",
  ] as const)("sets canRewind=false for %s", opcode => {
    const sim = makeSimulatedRuntime([1]);
    sim.runtime._step = () => {
      const fn = sim.runtime.getOpcodeFunction(opcode) as (() => unknown) | undefined;
      fn?.();
    };
    sim.runtime.getOpcodeFunction = (candidate: string) => {
      if (candidate === opcode) return () => 1;
      if (candidate === "operator_random") return () => 1;
      return undefined;
    };
    const handle = installRewindWithExtensions(sim);
    sim.runtime.fire("PROJECT_START");
    sim.runtime._step!();
    sim.runtime._step!();

    expect(handle.getSnapshot().canRewind).toBe(false);
    expect(handle.getSnapshot().rewindError).toMatch(/巻き戻せません/);
    expect(handle.getSnapshot().unsupportedOpcodes).toContain(opcode);
    handle.dispose();
  });

  it.each([
    ["music_playDrumForBeats", ["music"]],
    ["pen_clear", ["pen"]],
    ["text2speech_speak", ["text2speech"]],
  ] as const)("sets canRewind=false for extension opcode %s", (opcode, extensions) => {
    const sim = makeSimulatedRuntime([1]);
    sim.runtime._step = () => {
      const fn = sim.runtime.getOpcodeFunction(opcode) as (() => unknown) | undefined;
      fn?.();
    };
    sim.runtime.getOpcodeFunction = (candidate: string) => {
      if (candidate === opcode) return () => 1;
      if (candidate === "operator_random") return () => 1;
      return undefined;
    };
    const handle = installRewindWithExtensions(sim, [...extensions]);
    sim.runtime.fire("PROJECT_START");
    sim.runtime._step!();
    sim.runtime._step!();

    expect(handle.getSnapshot().canRewind).toBe(false);
    expect(handle.getSnapshot().unsupportedOpcodes).toContain(opcode);
    handle.dispose();
  });

  it("keeps canRewind=true for argument_reporter_* opcodes", () => {
    const sim = makeSimulatedRuntime([1, 2]);
    sim.runtime._step = () => {
      const fn = sim.runtime.getOpcodeFunction(
        "argument_reporter_string_number",
      ) as (() => unknown) | undefined;
      fn?.();
      sim.runtime.updateCurrentMSecs();
      sim.runtime.ioDevices.clock.projectTimer();
      const random = sim.runtime.getOpcodeFunction("operator_random") as (
        args: {FROM: number; TO: number},
      ) => number;
      sim.target.x += random({FROM: 1, TO: 10});
    };
    sim.runtime.getOpcodeFunction = (candidate: string) => {
      if (candidate === "argument_reporter_string_number") return () => "steps";
      if (candidate === "operator_random") {
        return sim.operatorRandom;
      }
      return undefined;
    };
    const handle = installRewindWithExtensions(sim, ["music"]);
    sim.runtime.fire("PROJECT_START");
    sim.runtime._step!();
    sim.runtime._step!();

    expect(handle.getSnapshot().canRewind).toBe(true);
    expect(handle.getSnapshot().unsupportedOpcodes).toEqual([]);
    handle.dispose();
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

  it("ignores wrapped _step calls while replaying", async () => {
    const sim = makeSimulatedRuntime([3, 5]);
    let releaseRestore: (() => void) | undefined;
    const restoreGate = new Promise<void>(resolve => {
      releaseRestore = resolve;
    });
    const handle = installExecutionRewind(
      {runtime: sim.runtime},
      {
        captureOrigin: () => makeOrigin(sim.runtime),
        restoreOrigin: async () => {
          sim.resetToOrigin();
          await restoreGate;
        },
        cloneOrderRegistry: sim.registry,
      },
    )!;

    sim.runtime.fire("PROJECT_START");
    sim.runtime._step!();
    sim.runtime._step!();

    const replayPromise = handle.replayToFrame(1);
    await Promise.resolve();
    expect(handle.getSnapshot().isReplaying).toBe(true);
    expect(sim.target.x).toBe(0);
    sim.runtime._step!();
    expect(sim.target.x).toBe(0);

    releaseRestore?.();
    await replayPromise;
    expect(sim.target.x).toBe(8);
    handle.dispose();
  });

  it("does not clear history on PROJECT_START while replaying", async () => {
    const {runtime, resetToOrigin, registry} = makeSimulatedRuntime([2, 4]);
    const journal = new RewindJournal();
    const handle = installExecutionRewind(
      {runtime},
      {
        journal,
        cloneOrderRegistry: registry,
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

  it("sets canRewind=false when unsupported stack frames are recorded", () => {
    const {runtime} = makeSimulatedRuntime([]);
    const handle = installExecutionRewind(
      {runtime},
      {captureOrigin: () => makeOrigin(runtime)},
    )!;

    runtime.fire("PROJECT_START");
    runtime.threads![0]!.stackFrames = [{
      executionContext: {fn: () => undefined},
    }];
    runtime._step!();

    expect(handle.getSnapshot().canRewind).toBe(false);
    expect(handle.getSnapshot().rewindError).toMatch(/巻き戻せません/);
    handle.dispose();
  });

  it("restores origin baseline when replay fails", async () => {
    const sim = makeSimulatedRuntime([2, 4]);
    const journal = new RewindJournal();
    const handle = installExecutionRewind(
      {runtime: sim.runtime},
      {
        journal,
        captureOrigin: () => makeOrigin(sim.runtime),
        restoreOrigin: async () => sim.resetToOrigin(),
        cloneOrderRegistry: sim.registry,
      },
    )!;

    sim.runtime.fire("PROJECT_START");
    sim.runtime._step!();
    sim.runtime._step!();
    expect(sim.target.x).toBe(6);

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

    const result = await handle.replayToFrame(1);
    expect(result.ok).toBe(false);
    expect(sim.target.x).toBe(0);
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
        cloneOrderRegistry: sim.registry,
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
        cloneOrderRegistry: sim.registry,
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
      cloneOrderRegistry: sim.registry,
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
        cloneOrderRegistry: sim.registry,
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
      cloneOrderRegistry: sim.registry,
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
        cloneOrderRegistry: sim.registry,
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
      cloneOrderRegistry: sim.registry,
      step: () => sim.runtime._step!(),
      restoreOrigin: async () => sim.resetToOrigin(),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Fingerprint/i);
    handle.dispose();
  });
});

describe("rewindFrame", () => {
  it("rewinds one scheduler frame and discards future history", async () => {
    const sim = makeSimulatedRuntime([3, 5, 2]);
    const origin = makeOrigin(sim.runtime);
    const handle = installExecutionRewind(
      {runtime: sim.runtime},
      {
        captureOrigin: () => origin,
        restoreOrigin: async () => sim.resetToOrigin(),
        cloneOrderRegistry: sim.registry,
      },
    )!;

    sim.runtime.fire("PROJECT_START");
    sim.runtime._step!();
    sim.runtime._step!();
    sim.runtime._step!();
    expect(sim.target.x).toBe(10);
    expect(handle.getFrames()).toHaveLength(3);

    const result = await handle.rewindFrame();
    expect(result.ok).toBe(true);
    expect(result.targetFrameIndex).toBe(1);
    expect(sim.target.x).toBe(8);
    expect(handle.getFrames()).toHaveLength(2);
    expect(handle.getSnapshot().rewindDepth).toBe(1);

    handle.dispose();
  });

  it("truncates trace and wraps replay in lifecycle hooks", async () => {
    const sim = makeSimulatedRuntime([2, 4, 6]);
    const lifecycle: Array<"start" | "end"> = [];
    let truncatedTo = -1;
    let traceSize = 0;
    const handle = installExecutionRewind(
      {runtime: sim.runtime},
      {
        captureOrigin: () => makeOrigin(sim.runtime),
        restoreOrigin: async () => sim.resetToOrigin(),
        cloneOrderRegistry: sim.registry,
        getTraceSize: () => {
          traceSize += 3;
          return traceSize;
        },
        onReplayLifecycle: phase => lifecycle.push(phase),
        onTraceTruncate: size => {
          truncatedTo = size;
        },
      },
    )!;

    sim.runtime.fire("PROJECT_START");
    sim.runtime._step!();
    sim.runtime._step!();
    sim.runtime._step!();

    const result = await handle.rewindFrame();
    expect(result.ok).toBe(true);
    expect(lifecycle).toEqual(["start", "end"]);
    expect(truncatedTo).toBe(6);
    handle.dispose();
  });

  it("returns an error when rewind is unavailable", async () => {
    const sim = makeSimulatedRuntime([]);
    const handle = installExecutionRewind(
      {runtime: sim.runtime},
      {captureOrigin: () => makeOrigin(sim.runtime)},
    )!;

    sim.runtime.fire("PROJECT_START");
    sim.runtime._step!();
    const result = await handle.rewindFrame();
    expect(result.ok).toBe(false);
    handle.dispose();
  });
});

describe("wrapper order with execution trace and control", () => {
  it("records frames only when _step actually runs", () => {
    const sim = makeSimulatedRuntime([1, 2]);

    const rewind = installExecutionRewind(
      {runtime: sim.runtime},
      {
        captureOrigin: () => makeOrigin(sim.runtime),
        cloneOrderRegistry: sim.registry,
      },
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
