import {describe, expect, it, vi} from "vitest";
import {
  installExecutionControl,
  readActiveBlockIds,
  type ExecutionRuntimeLike,
  type ExecutionVmLike,
} from "./execution-control.js";

function makeVm(overrides: Partial<ExecutionRuntimeLike> = {}): {
  vm: ExecutionVmLike;
  runtime: ExecutionRuntimeLike;
  step: ReturnType<typeof vi.fn>;
  highlight: ReturnType<typeof vi.fn>;
} {
  const step = vi.fn(() => "stepped");
  const highlight = vi.fn();
  const runtime: ExecutionRuntimeLike = {
    threads: [],
    _step: step,
    ...overrides,
  };
  return {vm: {runtime}, runtime, step, highlight};
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

  it("skips monitor threads and de-duplicates", () => {
    expect(
      readActiveBlockIds({
        threads: [
          {blockGlowInFrame: "shared"},
          {blockGlowInFrame: "shared"},
          {blockGlowInFrame: "monitor", updateMonitor: true},
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
