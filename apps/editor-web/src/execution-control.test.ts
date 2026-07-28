import {describe, expect, it, vi} from "vitest";
import {
  countRunnableNonMonitorThreads,
  guardGlowUpdates,
  installExecutionControl,
  readActiveBlockIds,
  retireOrphanThreads,
  type ExecutionRuntimeLike,
  type ExecutionVmLike,
} from "./execution-control.js";

function makeVm(overrides: Partial<ExecutionRuntimeLike> = {}): {
  vm: ExecutionVmLike;
  runtime: ExecutionRuntimeLike;
  step: ReturnType<typeof vi.fn>;
  highlight: ReturnType<typeof vi.fn>;
  fire: (event: string) => void;
} {
  const step = vi.fn(() => "stepped");
  const highlight = vi.fn();
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  const runtime: ExecutionRuntimeLike = {
    threads: [],
    _step: step,
    on: (event, handler) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
    },
    off: (event, handler) => {
      handlers.get(event)?.delete(handler);
    },
    ...overrides,
  };
  const fire = (event: string) => {
    for (const handler of handlers.get(event) ?? []) handler();
  };
  return {vm: {runtime}, runtime, step, highlight, fire};
}

describe("readActiveBlockIds", () => {
  it("prefers the block the sequencer just ran", () => {
    expect(
      readActiveBlockIds({
        threads: [{blockGlowInFrame: "b1", peekStack: () => "b2"}],
      }),
    ).toEqual(["b1"]);
  });

  it("falls back to the top of the stack", () => {
    expect(
      readActiveBlockIds({threads: [{peekStack: () => "next"}]}),
    ).toEqual(["next"]);
  });

  it("skips monitor threads, killed threads, and de-duplicates", () => {
    expect(
      readActiveBlockIds({
        threads: [
          {blockGlowInFrame: "shared"},
          {blockGlowInFrame: "shared"},
          {blockGlowInFrame: "monitor", updateMonitor: true},
          {blockGlowInFrame: "killed", isKilled: true},
          {blockGlowInFrame: "done", status: 4},
          {blockGlowInFrame: "other"},
        ],
      }),
    ).toEqual(["shared", "other"]);
  });

  it("survives a throwing peekStack and missing runtime", () => {
    expect(
      readActiveBlockIds({
        threads: [
          {
            peekStack: () => {
              throw new Error("thread disposed");
            },
          },
        ],
      }),
    ).toEqual([]);
    expect(readActiveBlockIds(null)).toEqual([]);
    expect(readActiveBlockIds({})).toEqual([]);
  });
});

describe("countRunnableNonMonitorThreads", () => {
  it("counts active non-monitor threads only", () => {
    expect(
      countRunnableNonMonitorThreads({
        threads: [
          {status: 0},
          {updateMonitor: true, status: 0},
          {isKilled: true, status: 0},
          {status: 4},
        ],
      }),
    ).toBe(1);
    expect(countRunnableNonMonitorThreads({threads: []})).toBe(0);
  });
});

describe("retireOrphanThreads", () => {
  it("kills threads whose hat block was deleted", () => {
    const stop = vi.fn((thread: {isKilled?: boolean}) => {
      thread.isKilled = true;
    });
    const alive = {
      topBlock: "hat",
      target: {
        blocks: {
          getScripts: () => ["hat"],
          getBlock: (id: string) =>
            id === "hat" ? {opcode: "event_whenflagclicked"} : null,
        },
      },
    };
    const orphan = {
      topBlock: "gone",
      target: {blocks: {getScripts: () => [], getBlock: () => undefined}},
    };
    const runtime: ExecutionRuntimeLike = {
      threads: [alive, orphan],
      _stopThread: stop,
    };

    expect(retireOrphanThreads(runtime)).toBe(1);
    expect(runtime.threads).toHaveLength(2);
    expect(orphan.isKilled).toBe(true);
    expect(stop).toHaveBeenCalledWith(orphan);
  });

  it("kills threads whose current stack block was deleted", () => {
    const orphan = {
      topBlock: "hat",
      peekStack: () => "loop",
      target: {
        blocks: {
          getScripts: () => ["hat"],
          getBlock: (id: string) =>
            id === "hat" ? {opcode: "event_whenflagclicked"} : undefined,
        },
      },
    };
    const runtime: ExecutionRuntimeLike = {threads: [orphan]};
    expect(retireOrphanThreads(runtime)).toBe(1);
    expect(runtime.threads).toHaveLength(1);
    expect(orphan.isKilled).toBe(true);
  });

  it("leaves monitor threads and intact scripts alone", () => {
    const runtime: ExecutionRuntimeLike = {
      threads: [
        {
          topBlock: "hat",
          updateMonitor: true,
          target: {blocks: {getScripts: () => [], getBlock: () => undefined}},
        },
        {
          topBlock: "hat",
          peekStack: () => "hat",
          target: {
            blocks: {
              getScripts: () => ["hat"],
              getBlock: () => ({opcode: "event_whenflagclicked"}),
            },
          },
        },
      ],
    };
    expect(retireOrphanThreads(runtime)).toBe(0);
    expect(runtime.threads).toHaveLength(2);
  });
});

// Runtime._step draws the stage only after _updateGlows returns, so a throw
// there freezes the picture while the project keeps running.
describe("guardGlowUpdates", () => {
  it("swallows a glow failure and reports it", () => {
    const onError = vi.fn();
    const runtime = {
      _updateGlows: () => {
        throw new Error("Tried to glow block that does not exist.");
      },
    };
    guardGlowUpdates(runtime, onError);

    expect(() => runtime._updateGlows()).not.toThrow();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("passes arguments through and returns the result when it works", () => {
    const inner = vi.fn(() => "ok");
    const runtime = {_updateGlows: inner};
    guardGlowUpdates(runtime);

    expect(runtime._updateGlows("a", "b")).toBe("ok");
    expect(inner).toHaveBeenCalledWith("a", "b");
  });

  it("is idempotent and restorable", () => {
    const inner = vi.fn();
    const runtime = {_updateGlows: inner};
    const remove = guardGlowUpdates(runtime);
    const wrapped = runtime._updateGlows;
    guardGlowUpdates(runtime);
    expect(runtime._updateGlows, "second call must not double-wrap").toBe(wrapped);

    remove();
    expect(runtime._updateGlows).toBe(inner);
  });

  it("does nothing when the runtime has no _updateGlows", () => {
    const runtime: {_updateGlows?: () => void} = {};
    expect(() => guardGlowUpdates(runtime)()).not.toThrow();
  });
});

describe("installExecutionControl", () => {
  it("returns null when the runtime has no _step to gate", () => {
    expect(installExecutionControl({runtime: null})).toBeNull();
    expect(installExecutionControl({runtime: {}})).toBeNull();
  });

  it("runs steps normally until paused", () => {
    const {vm, runtime, step} = makeVm();
    const control = installExecutionControl(vm)!;

    runtime._step!();
    runtime._step!();
    expect(step).toHaveBeenCalledTimes(2);
    expect(control.getSnapshot().state).toBe("running");

    control.pause();
    runtime._step!();
    runtime._step!();
    expect(step).toHaveBeenCalledTimes(2);
    expect(control.getSnapshot().state).toBe("paused");
  });

  it("repaints the stage on idle scheduler ticks while paused", () => {
    const draw = vi.fn();
    const {vm, runtime, step} = makeVm({
      renderer: {draw},
    } as Partial<ExecutionRuntimeLike>);
    const control = installExecutionControl(vm)!;

    control.pause();
    runtime._step!();
    runtime._step!();

    expect(step).not.toHaveBeenCalled();
    expect(draw).toHaveBeenCalledTimes(2);
  });

  it("advances exactly one frame per stepFrame", () => {
    const {vm, runtime, step} = makeVm();
    const control = installExecutionControl(vm)!;
    control.pause();

    control.stepFrame();
    runtime._step!();
    runtime._step!();
    expect(step).toHaveBeenCalledTimes(1);

    control.stepFrame();
    control.stepFrame();
    runtime._step!();
    runtime._step!();
    runtime._step!();
    expect(step).toHaveBeenCalledTimes(3);
    expect(control.getSnapshot().steppedFrames).toBe(3);
  });

  it("stepFrame pauses a running VM first", () => {
    const {vm, runtime, step} = makeVm();
    const control = installExecutionControl(vm)!;

    control.stepFrame();
    expect(control.getSnapshot().state).toBe("paused");
    runtime._step!();
    runtime._step!();
    expect(step).toHaveBeenCalledTimes(1);
  });

  it("resume lets the VM free-run again and drops queued steps", () => {
    const {vm, runtime, step} = makeVm();
    const control = installExecutionControl(vm)!;

    control.stepFrame();
    control.stepFrame();
    control.resume();
    runtime._step!();
    expect(step).toHaveBeenCalledTimes(1);
    expect(control.getSnapshot().state).toBe("running");
  });

  it("highlights the active blocks while paused and clears them on resume", () => {
    const {vm, highlight} = makeVm({
      threads: [{blockGlowInFrame: "b1"}, {blockGlowInFrame: "b2"}],
    });
    const control = installExecutionControl(vm, {highlight})!;

    control.pause();
    expect(highlight).toHaveBeenLastCalledWith(["b1", "b2"]);
    expect(control.getSnapshot().highlightedBlockIds).toEqual(["b1", "b2"]);

    control.resume();
    expect(highlight).toHaveBeenLastCalledWith([]);
    expect(control.getSnapshot().highlightedBlockIds).toEqual([]);
  });

  it("repaints only when the highlighted set actually changes", () => {
    const threads: Array<{blockGlowInFrame: string}> = [
      {blockGlowInFrame: "b1"},
    ];
    const {vm, runtime, highlight} = makeVm({threads});
    const control = installExecutionControl(vm, {highlight})!;
    control.pause();
    expect(highlight).toHaveBeenCalledTimes(1);

    // Same block still on top: no repaint.
    control.stepFrame();
    runtime._step!();
    expect(highlight).toHaveBeenCalledTimes(1);

    threads[0]!.blockGlowInFrame = "b2";
    control.stepFrame();
    runtime._step!();
    expect(highlight).toHaveBeenCalledTimes(2);
    expect(highlight).toHaveBeenLastCalledWith(["b2"]);
  });

  it("keeps stepping when the highlighter throws", () => {
    const {vm, runtime, step} = makeVm({threads: [{blockGlowInFrame: "b1"}]});
    const control = installExecutionControl(vm, {
      highlight: () => {
        throw new Error("workspace gone");
      },
    })!;

    expect(() => control.pause()).not.toThrow();
    control.stepFrame();
    expect(() => runtime._step!()).not.toThrow();
    expect(step).toHaveBeenCalledTimes(1);
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const {vm} = makeVm();
    const control = installExecutionControl(vm)!;
    const seen: string[] = [];
    const unsubscribe = control.subscribe(s => seen.push(s.state));

    control.pause();
    control.resume();
    expect(seen).toEqual(["paused", "running"]);

    unsubscribe();
    control.pause();
    expect(seen).toEqual(["paused", "running"]);
  });

  it("keeps running when a subscriber throws", () => {
    const {vm, runtime, step} = makeVm();
    const control = installExecutionControl(vm)!;
    control.subscribe(() => {
      throw new Error("bad listener");
    });

    expect(() => control.pause()).not.toThrow();
    control.stepFrame();
    expect(() => runtime._step!()).not.toThrow();
    expect(step).toHaveBeenCalledTimes(1);
  });

  // Pressing the green flag while paused looked like a broken editor: the
  // thread starts but nothing moves.
  it("the green flag resumes a paused VM", () => {
    const {vm, runtime, step, fire, highlight} = makeVm({
      threads: [{blockGlowInFrame: "b1"}],
    });
    const control = installExecutionControl(vm, {highlight})!;
    control.pause();
    expect(control.getSnapshot().state).toBe("paused");

    fire("PROJECT_START");
    expect(control.getSnapshot().state).toBe("running");
    expect(highlight).toHaveBeenLastCalledWith([]);

    runtime._step!();
    runtime._step!();
    expect(step).toHaveBeenCalledTimes(2);
  });

  it("the green flag leaves an already running VM alone", () => {
    const {vm, fire} = makeVm();
    const control = installExecutionControl(vm)!;
    const states: string[] = [];
    control.subscribe(s => states.push(s.state));

    fire("PROJECT_START");
    expect(control.getSnapshot().state).toBe("running");
    expect(states, "no redundant notification").toEqual([]);
  });

  it("dispose stops listening for the green flag", () => {
    const {vm, fire} = makeVm();
    const control = installExecutionControl(vm)!;
    control.pause();
    control.dispose();
    expect(() => fire("PROJECT_START")).not.toThrow();
  });

  // Deleting a forever loop while paused used to leave the thread alive. The
  // workspace looked empty, then resume / green flag could still advance it.
  it("retires orphan threads when blocks are deleted while paused", async () => {
    const orphan = {
      topBlock: "hat",
      target: {blocks: {getBlock: () => undefined}},
    };
    const {vm, runtime, fire, step} = makeVm({threads: [orphan]});
    const control = installExecutionControl(vm)!;
    control.pause();

    fire("PROJECT_CHANGED");
    await Promise.resolve();
    expect(orphan.isKilled).toBe(true);
    expect(runtime.threads).toHaveLength(1);

    // A later step must not revive motion from the deleted script.
    control.resume();
    runtime._step!();
    expect(step).toHaveBeenCalledTimes(1);
  });

  it("dispose restores the original _step and clears the highlight", () => {
    const {vm, runtime, step, highlight} = makeVm({
      threads: [{blockGlowInFrame: "b1"}],
    });
    const control = installExecutionControl(vm, {highlight})!;
    control.pause();

    control.dispose();
    expect(highlight).toHaveBeenLastCalledWith([]);
    expect(runtime._step).toBe(step);

    runtime._step!();
    expect(step).toHaveBeenCalledTimes(1);
  });
});
