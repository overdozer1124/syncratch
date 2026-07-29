import {describe, expect, it, vi} from "vitest";
import {
  createExecutionTrace,
  installExecutionTrace,
  instrumentThread,
  resolveTraceEntries,
  type TraceRuntimeLike,
  type TraceThreadLike,
} from "./execution-trace.js";
import {
  entriesWouldCoalesce,
  extractBlockSnapshotArgs,
  installPrimitiveTraceCapture,
  recordHatBlockStart,
  shouldRecordCommand,
} from "./execution-trace-capture.js";
import {describeTraceSnapshot} from "./execution-trace-format.js";

describe("createExecutionTrace", () => {
  it("records executions oldest first without coalescing", () => {
    let clock = 100;
    const trace = createExecutionTrace({now: () => clock});
    trace.record({
      blockId: "a",
      targetId: "t1",
      targetName: "ネコ",
      snapshot: {opcode: "motion_movesteps", args: {STEPS: 1}},
    });
    clock = 101;
    trace.record({
      blockId: "a",
      targetId: "t1",
      targetName: "ネコ",
      snapshot: {opcode: "motion_movesteps", args: {STEPS: 1}},
    });

    expect(trace.getEntries()).toHaveLength(2);
  });

  it("does not coalesce different argument values", () => {
    const trace = createExecutionTrace({now: () => 0});
    trace.record({
      blockId: "move",
      targetId: "t1",
      targetName: null,
      snapshot: {opcode: "motion_movesteps", args: {STEPS: 10}},
    });
    trace.record({
      blockId: "move",
      targetId: "t1",
      targetName: null,
      snapshot: {opcode: "motion_movesteps", args: {STEPS: 5}},
    });
    expect(trace.getEntries()).toHaveLength(2);
  });

  it("drops the oldest entries past the limit", () => {
    const trace = createExecutionTrace({limit: 3, now: () => 0});
    for (const id of ["a", "b", "c", "d", "e"]) {
      trace.record({
        blockId: id,
        targetId: null,
        targetName: null,
        snapshot: {opcode: "motion_movesteps", args: {STEPS: 1}},
      });
    }
    expect(trace.getEntries().map(e => e.blockId)).toEqual(["c", "d", "e"]);
  });

  it("truncateTo drops newest entries beyond the requested size", () => {
    const trace = createExecutionTrace({now: () => 0});
    for (const id of ["a", "b", "c", "d"]) {
      trace.record({
        blockId: id,
        targetId: null,
        targetName: null,
        snapshot: {opcode: "motion_movesteps", args: {STEPS: 1}},
      });
    }
    trace.truncateTo(2);
    expect(trace.size()).toBe(2);
    expect(trace.getEntries().map(entry => entry.blockId)).toEqual(["a", "b"]);
  });

  it("truncateTo cannot restore entries already dropped by the rolling limit", () => {
    const trace = createExecutionTrace({limit: 3, now: () => 0});
    for (const id of ["a", "b", "c"]) {
      trace.record({
        blockId: id,
        targetId: null,
        targetName: null,
        snapshot: {opcode: "motion_movesteps", args: {STEPS: 1}},
      });
    }
    const traceSizeAtFrame = trace.size();
    trace.record({
      blockId: "d",
      targetId: null,
      targetName: null,
      snapshot: {opcode: "motion_movesteps", args: {STEPS: 1}},
    });
    trace.truncateTo(traceSizeAtFrame);
    expect(trace.getEntries().map(entry => entry.blockId)).toEqual([
      "b",
      "c",
      "d",
    ]);
  });

  it("stores semantic snapshots independently from later edits", () => {
    const trace = createExecutionTrace({now: () => 0});
    trace.record({
      blockId: "move",
      targetId: "t1",
      targetName: "ネコ",
      snapshot: {
        opcode: "motion_movesteps",
        displayTemplate: "%1 歩動かす",
        args: {STEPS: 10},
      },
    });
    const stored = trace.getEntries()[0]!.snapshot;
    stored.args.STEPS = 99;
    expect(trace.getEntries()[0]!.snapshot.args.STEPS).toBe(10);
  });
});

describe("entriesWouldCoalesce", () => {
  it("returns false for different args or results", () => {
    const previous = {
      blockId: "a",
      targetId: "t1",
      targetName: null,
      time: 1,
      snapshot: {opcode: "motion_movesteps", args: {STEPS: 10}, result: null},
    };
    expect(
      entriesWouldCoalesce(previous, {
        blockId: "a",
        targetId: "t1",
        targetName: null,
        snapshot: {opcode: "motion_movesteps", args: {STEPS: 5}, result: null},
      }),
    ).toBe(false);
  });
});

describe("shouldRecordCommand", () => {
  it("records only when peekStack block opcode matches primitive", () => {
    const util = {
      thread: {peekStack: () => "move"},
      target: {
        blocks: {
          getBlock: (id: string) =>
            id === "move" ? {opcode: "motion_movesteps"} : null,
        },
      },
    };
    expect(shouldRecordCommand("motion_movesteps", util)).toBe(true);
    expect(shouldRecordCommand("math_number", util)).toBe(false);
  });
});

describe("instrumentThread", () => {
  it("records hat block start once per thread", () => {
    const trace = createExecutionTrace({now: () => 0});
    const thread: TraceThreadLike = {
      topBlock: "hat",
      target: {
        id: "sprite1",
        getName: () => "ネコ",
        blocks: {getBlock: () => ({opcode: "event_whenflagclicked"})},
      },
    };
    instrumentThread(thread, trace);
    instrumentThread(thread, trace);
    expect(trace.getEntries()).toHaveLength(1);
    expect(trace.getEntries()[0]?.snapshot.opcode).toBe("event_whenflagclicked");
  });

  it("captures key name from when-key-pressed hat fields", () => {
    const trace = createExecutionTrace({now: () => 0});
    const thread: TraceThreadLike = {
      topBlock: "hat",
      target: {
        id: "sprite1",
        getName: () => "Sprite1",
        blocks: {
          getBlock: () => ({
            opcode: "event_whenkeypressed",
            fields: {KEY_OPTION: {name: "KEY_OPTION", value: "space"}},
          }),
        },
      },
    };
    instrumentThread(thread, trace);
    const entry = trace.getEntries()[0];
    expect(entry?.snapshot.args.KEY_OPTION).toBe("space");
    expect(describeTraceSnapshot(entry!.snapshot)).toBe("スペースキーが押された");
  });
});

describe("extractBlockSnapshotArgs / recordHatBlockStart", () => {
  it("reads sb3-shaped field arrays", () => {
    expect(
      extractBlockSnapshotArgs({
        opcode: "event_whenkeypressed",
        fields: {KEY_OPTION: ["right arrow", null]},
      }),
    ).toEqual({KEY_OPTION: "right arrow"});
  });

  it("reads greater-than hat menu field and shadow VALUE", () => {
    const blocks: Record<
      string,
      {
        opcode?: string;
        fields?: Record<string, unknown>;
        inputs?: Record<string, unknown>;
      }
    > = {
      n1: {opcode: "math_number", fields: {NUM: {name: "NUM", value: "10"}}},
    };
    const hat = {
      opcode: "event_whengreaterthan",
      fields: {WHENGREATERTHANMENU: {name: "WHENGREATERTHANMENU", value: "loudness"}},
      inputs: {VALUE: {name: "VALUE", block: "n1", shadow: "n1"}},
    };
    const args = extractBlockSnapshotArgs(hat, id => blocks[id] ?? null);
    expect(args).toEqual({WHENGREATERTHANMENU: "loudness", VALUE: "10"});
  });

  it("reads sb3 shadow literal inputs for greater-than hats", () => {
    expect(
      extractBlockSnapshotArgs({
        opcode: "event_whengreaterthan",
        fields: {WHENGREATERTHANMENU: ["timer", null]},
        inputs: {VALUE: [1, [4, "5"]]},
      }),
    ).toEqual({WHENGREATERTHANMENU: "timer", VALUE: "5"});
  });

  it("records broadcast / backdrop hat option fields for learner text", () => {
    const recorded: Array<{snapshot: {opcode: string; args: Record<string, unknown>}}> = [];
    const recorder = {
      record(entry: {snapshot: {opcode: string; args: Record<string, unknown>}}) {
        recorded.push(entry);
      },
    };

    recordHatBlockStart(recorder, {
      topBlock: "bcast",
      target: {
        id: "t1",
        getName: () => "Sprite1",
        blocks: {
          getBlock: () => ({
            opcode: "event_whenbroadcastreceived",
            fields: {
              BROADCAST_OPTION: {name: "BROADCAST_OPTION", value: "スタート", id: "b1"},
            },
          }),
        },
      },
    });
    expect(describeTraceSnapshot(recorded[0]!.snapshot as never)).toBe(
      "「スタート」を受け取った",
    );

    recorded.length = 0;
    recordHatBlockStart(recorder, {
      topBlock: "back",
      target: {
        id: "t1",
        getName: () => "Sprite1",
        blocks: {
          getBlock: () => ({
            opcode: "event_whenbackdropswitchesto",
            fields: {BACKDROP: {name: "BACKDROP", value: "背景1"}},
          }),
        },
      },
    });
    expect(describeTraceSnapshot(recorded[0]!.snapshot as never)).toBe(
      "背景が「背景1」になった",
    );
  });
});

describe("installExecutionTrace", () => {
  function makeVm() {
    const threads: TraceThreadLike[] = [];
    const primitives = new Map<string, (...args: unknown[]) => unknown>();
    const step = vi.fn();
    const handlers = new Map<string, Set<(...a: unknown[]) => void>>();
    const runtime: TraceRuntimeLike = {
      threads,
      _step: step,
      getOpcodeFunction: (opcode: string) => primitives.get(opcode),
      getBlocksJSON: () => [
        {type: "motion_movesteps", message0: "%1 歩動かす"},
        {type: "event_whenflagclicked", message0: "旗がクリックされたとき"},
      ],
      on: (event, handler) => {
        if (!handlers.has(event)) handlers.set(event, new Set());
        handlers.get(event)!.add(handler);
      },
      off: (event, handler) => handlers.get(event)?.delete(handler),
    };
    const fire = (event: string) => {
      for (const handler of handlers.get(event) ?? []) handler();
    };
    return {vm: {runtime}, runtime, threads, step, fire, primitives};
  }

  it("wraps primitives and records evaluated args", () => {
    const {vm, runtime, threads, primitives} = makeVm();
    const move = vi.fn();
    primitives.set("motion_movesteps", move);
    const handle = installExecutionTrace(vm, {now: () => 0})!;

    const thread: TraceThreadLike = {
      topBlock: "hat",
      target: {
        id: "t1",
        getName: () => "ネコ",
        blocks: {
          getBlock: (id: string) =>
            id === "move" ? {opcode: "motion_movesteps"} : {opcode: "event_whenflagclicked"},
        },
      },
    };
    threads.push(thread);
    runtime._step!();

    const util = {
      thread: {peekStack: () => "move", target: thread.target},
      target: thread.target,
      stackFrame: {},
    };
    runtime.getOpcodeFunction!("motion_movesteps")({STEPS: 10}, util);

    expect(move).toHaveBeenCalledWith({STEPS: 10}, util);
    const entries = handle.trace.getEntries();
    expect(entries.some(entry => entry.snapshot.args.STEPS === 10)).toBe(true);

    handle.dispose();
    expect(runtime.getOpcodeFunction!("motion_movesteps")).toBe(move);
  });

  it("clears on PROJECT_START", () => {
    const {vm, fire} = makeVm();
    const handle = installExecutionTrace(vm, {now: () => 0})!;
    handle.trace.record({
      blockId: "old",
      targetId: "t1",
      targetName: null,
      snapshot: {opcode: "motion_movesteps", args: {}},
    });
    fire("PROJECT_START");
    expect(handle.trace.size()).toBe(0);
  });
});

describe("resolveTraceEntries", () => {
  it("fills missing target names from live targets", () => {
    const resolved = resolveTraceEntries(
      [
        {
          blockId: "b1",
          targetId: "t1",
          targetName: null,
          time: 1,
          snapshot: {opcode: "motion_movesteps", args: {STEPS: 10}},
        },
      ],
      [{id: "t1", getName: () => "ネコ"}],
    );
    expect(resolved[0]?.targetName).toBe("ネコ");
  });
});

describe("installPrimitiveTraceCapture", () => {
  it("restores getOpcodeFunction on dispose", () => {
    const original = vi.fn();
    const runtime = {
      getOpcodeFunction: vi.fn(() => original),
      getBlocksJSON: () => [],
    };
    const trace = createExecutionTrace();
    const dispose = installPrimitiveTraceCapture(runtime, trace);
    expect(runtime.getOpcodeFunction("x")).not.toBe(original);
    dispose();
    expect(runtime.getOpcodeFunction).toBe(runtime.getOpcodeFunction);
  });
});
