import {describe, expect, it} from "vitest";
import {
  entryScriptKey,
  filterEntriesByScript,
  isTraceHatOpcode,
  listTraceScripts,
  resolveSelectedScriptKey,
  traceScriptKey,
} from "./execution-trace-scripts.js";
import type {TraceEntry} from "./execution-trace-types.js";

function entry(
  overrides: Partial<TraceEntry> &
    Pick<TraceEntry, "blockId" | "topBlockId"> & {
      snapshot?: TraceEntry["snapshot"];
    },
): TraceEntry {
  return {
    targetId: "t1",
    targetName: "Sprite1",
    time: 0,
    snapshot: {opcode: "motion_movesteps", args: {STEPS: 10}},
    ...overrides,
  };
}

describe("isTraceHatOpcode", () => {
  it("recognizes common hats and rejects stack commands", () => {
    expect(isTraceHatOpcode("event_whenkeypressed")).toBe(true);
    expect(isTraceHatOpcode("event_whenflagclicked")).toBe(true);
    expect(isTraceHatOpcode("motion_movesteps")).toBe(false);
    expect(isTraceHatOpcode(null)).toBe(false);
  });
});

describe("listTraceScripts / filterEntriesByScript", () => {
  it("groups interleaved hats into separate scripts", () => {
    const entries = [
      entry({
        blockId: "hatA",
        topBlockId: "hatA",
        time: 1,
        snapshot: {opcode: "event_whenkeypressed", args: {KEY_OPTION: "space"}},
      }),
      entry({
        blockId: "moveA",
        topBlockId: "hatA",
        time: 2,
        snapshot: {opcode: "motion_movesteps", args: {STEPS: 10}},
      }),
      entry({
        blockId: "hatB",
        topBlockId: "hatB",
        time: 3,
        snapshot: {
          opcode: "event_whenkeypressed",
          args: {KEY_OPTION: "up arrow"},
        },
      }),
      entry({
        blockId: "moveB",
        topBlockId: "hatB",
        time: 4,
        snapshot: {opcode: "motion_movesteps", args: {STEPS: 5}},
      }),
      entry({
        blockId: "moveA2",
        topBlockId: "hatA",
        time: 5,
        snapshot: {opcode: "motion_turnright", args: {DEGREES: 15}},
      }),
    ];

    const scripts = listTraceScripts(entries);
    expect(scripts).toHaveLength(2);
    // Most recently active first (hatA got time 5).
    expect(scripts[0]?.topBlockId).toBe("hatA");
    expect(scripts[1]?.topBlockId).toBe("hatB");
    expect(scripts[0]?.label).toMatch(/スペース/);
    expect(scripts[1]?.label).toMatch(/上向き矢印/);

    const onlyA = filterEntriesByScript(entries, scripts[0]!.key);
    expect(onlyA.map(e => e.blockId)).toEqual(["hatA", "moveA", "moveA2"]);
    const onlyB = filterEntriesByScript(entries, scripts[1]!.key);
    expect(onlyB.map(e => e.blockId)).toEqual(["hatB", "moveB"]);
  });

  it("keeps a single hat-less stack as one script", () => {
    const entries = [
      entry({
        blockId: "move",
        topBlockId: "move",
        time: 1,
        snapshot: {opcode: "motion_movesteps", args: {STEPS: 10}},
      }),
      entry({
        blockId: "turn",
        topBlockId: "move",
        time: 2,
        snapshot: {opcode: "motion_turnright", args: {DEGREES: 90}},
      }),
    ];
    const scripts = listTraceScripts(entries);
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.topBlockId).toBe("move");
    expect(filterEntriesByScript(entries, scripts[0]!.key)).toHaveLength(2);
  });
});

describe("resolveSelectedScriptKey", () => {
  it("prefers a still-valid selection, else the latest script", () => {
    const scripts = listTraceScripts([
      entry({
        blockId: "a",
        topBlockId: "a",
        time: 1,
        snapshot: {opcode: "event_whenflagclicked", args: {}},
      }),
      entry({
        blockId: "b",
        topBlockId: "b",
        time: 2,
        snapshot: {opcode: "event_whenkeypressed", args: {KEY_OPTION: "space"}},
      }),
    ]);
    const latest = resolveSelectedScriptKey(scripts, null);
    expect(latest).toBe(traceScriptKey("b", "t1"));
    expect(resolveSelectedScriptKey(scripts, traceScriptKey("a", "t1"))).toBe(
      entryScriptKey({blockId: "a", topBlockId: "a", targetId: "t1"}),
    );
    expect(resolveSelectedScriptKey(scripts, "missing")).toBe(latest);
  });
});
