import {describe, expect, it, vi} from "vitest";
import {
  createExecutionTrace,
  installExecutionTrace,
  instrumentThread,
  resolveTraceEntries,
  type TraceRuntimeLike,
  type TraceThreadLike,
} from "./execution-trace.js";

describe("createExecutionTrace", () => {
  it("records executions oldest first", () => {
    let clock = 100;
    const trace = createExecutionTrace({now: () => clock});
    trace.record("a", "t1");
    clock = 101;
    trace.record("b", "t1");

    expect(trace.getEntries()).toEqual([
      {blockId: "a", targetId: "t1", firstTime: 100, lastTime: 100, count: 1},
      {blockId: "b", targetId: "t1", firstTime: 101, lastTime: 101, count: 1},
    ]);
  });

  it("coalesces consecutive runs of the same block", () => {
    let clock = 0;
    const trace = createExecutionTrace({now: () => (clock += 10)});
    trace.record("loop", "t1");
    trace.record("loop", "t1");
    trace.record("loop", "t1");

    const entries = trace.getEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      blockId: "loop",
      count: 3,
      firstTime: 10,
      lastTime: 30,
    });
  });

  it("does not coalesce across different targets", () => {
    const trace = createExecutionTrace({now: () => 0});
    trace.record("same", "t1");
    trace.record("same", "t2");
    expect(trace.getEntries()).toHaveLength(2);
  });

  it("does not coalesce when another block runs in between", () => {
    const trace = createExecutionTrace({now: () => 0});
    trace.record("a", "t1");
    trace.record("b", "t1");
    trace.record("a", "t1");
    expect(trace.getEntries().map(e => e.blockId)).toEqual(["a", "b", "a"]);
  });

  it("drops the oldest entries past the limit", () => {
    const trace = createExecutionTrace({limit: 3, now: () => 0});
    for (const id of ["a", "b", "c", "d", "e"]) trace.record(id, null);
    expect(trace.getEntries().map(e => e.blockId)).toEqual(["c", "d", "e"]);
    expect(trace.size()).toBe(3);
  });

  it("ignores empty block ids and supports clear", () => {
    const trace = createExecutionTrace({now: () => 0});
    trace.record("", "t1");
    expect(trace.size()).toBe(0);
    trace.record("a", "t1");
    trace.clear();
    expect(trace.getEntries()).toEqual([]);
  });

  it("hands out copies so callers cannot mutate the buffer", () => {
    const trace = createExecutionTrace({now: () => 0});
    trace.record("a", "t1");
    trace.getEntries()[0]!.count = 999;
    expect(trace.getEntries()[0]!.count).toBe(1);
  });
});

describe("instrumentThread", () => {
  it("records the thread's hat block, which the sequencer never runs", () => {
    const trace = createExecutionTrace({now: () => 0});
    const thread: TraceThreadLike = {
      topBlock: "hat",
      blockGlowInFrame: null,
      target: {id: "sprite1"},
    };
    instrumentThread(thread, trace);
    thread.blockGlowInFrame = "b1";

    expect(trace.getEntries().map(e => e.blockId)).toEqual(["hat", "b1"]);
  });

  it("records every write to blockGlowInFrame", () => {
    const trace = createExecutionTrace({now: () => 0});
    const thread: TraceThreadLike = {
      blockGlowInFrame: null,
      target: {id: "sprite1"},
    };
    expect(instrumentThread(thread, trace)).toBe(true);

    thread.blockGlowInFrame = "b1";
    thread.blockGlowInFrame = "b2";

    expect(trace.getEntries().map(e => e.blockId)).toEqual(["b1", "b2"]);
    expect(trace.getEntries()[0]!.targetId).toBe("sprite1");
  });

  it("keeps the property readable for the VM's own glow logic", () => {
    const trace = createExecutionTrace({now: () => 0});
    const thread: TraceThreadLike = {blockGlowInFrame: null, target: {id: "t"}};
    instrumentThread(thread, trace);

    thread.blockGlowInFrame = "b1";
    expect(thread.blockGlowInFrame).toBe("b1");
    thread.blockGlowInFrame = null;
    expect(thread.blockGlowInFrame).toBeNull();
  });

  it("is idempotent and skips monitor threads", () => {
    const trace = createExecutionTrace({now: () => 0});
    const thread: TraceThreadLike = {blockGlowInFrame: null, target: {id: "t"}};
    expect(instrumentThread(thread, trace)).toBe(true);
    expect(instrumentThread(thread, trace)).toBe(false);

    thread.blockGlowInFrame = "b1";
    expect(trace.size()).toBe(1);

    const monitor: TraceThreadLike = {updateMonitor: true, target: {id: "t"}};
    expect(instrumentThread(monitor, trace)).toBe(false);
    monitor.blockGlowInFrame = "monitor-block";
    expect(trace.size()).toBe(1);
  });

  it("skips a frozen thread instead of throwing", () => {
    const trace = createExecutionTrace({now: () => 0});
    const thread = Object.freeze({
      blockGlowInFrame: null,
      target: {id: "t"},
    }) as TraceThreadLike;
    expect(instrumentThread(thread, trace)).toBe(false);
  });
});

describe("installExecutionTrace", () => {
  function makeVm() {
    const threads: TraceThreadLike[] = [];
    const step = vi.fn();
    const runtime: TraceRuntimeLike = {threads, _step: step};
    return {vm: {runtime}, runtime, threads, step};
  }

  it("returns null without a runtime to wrap", () => {
    expect(installExecutionTrace({runtime: null})).toBeNull();
    expect(installExecutionTrace({runtime: {}})).toBeNull();
  });

  it("instruments threads that appear later and keeps stepping", () => {
    const {vm, runtime, threads, step} = makeVm();
    const handle = installExecutionTrace(vm, {now: () => 0})!;

    runtime._step!();
    expect(step).toHaveBeenCalledTimes(1);

    // scratch-vm creates a fresh Thread per script run.
    const thread: TraceThreadLike = {blockGlowInFrame: null, target: {id: "t"}};
    threads.push(thread);
    runtime._step!();

    thread.blockGlowInFrame = "b1";
    expect(handle.trace.getEntries().map(e => e.blockId)).toEqual(["b1"]);
  });

  it("dispose restores the original _step and stops recording new threads", () => {
    const {vm, runtime, threads, step} = makeVm();
    const handle = installExecutionTrace(vm, {now: () => 0})!;

    handle.dispose();
    expect(runtime._step).toBe(step);

    threads.push({blockGlowInFrame: null, target: {id: "t"}});
    runtime._step!();
    threads[0]!.blockGlowInFrame = "b1";
    expect(handle.trace.size()).toBe(0);
  });
});

describe("resolveTraceEntries", () => {
  const targets = [
    {
      id: "t1",
      getName: () => "ネコ",
      blocks: {
        getBlock: (id: string) =>
          id === "b1" ? {opcode: "motion_movesteps"} : null,
      },
    },
  ];

  it("attaches opcode and sprite name", () => {
    const resolved = resolveTraceEntries(
      [{blockId: "b1", targetId: "t1", firstTime: 1, lastTime: 2, count: 3}],
      targets,
    );
    expect(resolved[0]).toMatchObject({
      blockId: "b1",
      opcode: "motion_movesteps",
      targetName: "ネコ",
      count: 3,
    });
  });

  it("keeps entries whose block or target was deleted", () => {
    const resolved = resolveTraceEntries(
      [
        {blockId: "gone", targetId: "t1", firstTime: 1, lastTime: 1, count: 1},
        {blockId: "b1", targetId: "missing", firstTime: 1, lastTime: 1, count: 1},
      ],
      targets,
    );
    expect(resolved).toHaveLength(2);
    expect(resolved[0]).toMatchObject({opcode: null, targetName: "ネコ"});
    expect(resolved[1]).toMatchObject({opcode: null, targetName: null});
  });

  it("survives targets that throw on lookup", () => {
    const resolved = resolveTraceEntries(
      [{blockId: "b1", targetId: "t1", firstTime: 1, lastTime: 1, count: 1}],
      [
        {
          id: "t1",
          getName: () => {
            throw new Error("disposed");
          },
          blocks: {
            getBlock: () => {
              throw new Error("disposed");
            },
          },
        },
      ],
    );
    expect(resolved[0]).toMatchObject({opcode: null, targetName: null});
  });

  it("handles a missing target list", () => {
    const resolved = resolveTraceEntries(
      [{blockId: "b1", targetId: "t1", firstTime: 1, lastTime: 1, count: 1}],
      null,
    );
    expect(resolved[0]).toMatchObject({opcode: null, targetName: null});
  });
});
