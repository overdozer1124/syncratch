import {describe, expect, it} from "vitest";
import {allowedOpcodeSet} from "@blocksync/project-schema";
import {
  assertAllCoreOpcodesCovered,
  createTraceDescriptorContext,
  describeTraceSnapshot,
  getTraceDescriptor,
  indexBlockTemplates,
  lookupBlockTemplate,
  traceDescriptorsForTest,
} from "./execution-trace-format.js";
import type {TraceBlockUtilLike, TraceSemanticSnapshot} from "./execution-trace-types.js";

describe("describeTraceSnapshot", () => {
  it("formats motion_movesteps with string shadow values", () => {
    expect(
      describeTraceSnapshot({
        opcode: "motion_movesteps",
        args: {STEPS: "10"},
      }),
    ).toBe("10歩動いた");
  });

  it("formats motion_movesteps with evaluated steps", () => {
    expect(
      describeTraceSnapshot({
        opcode: "motion_movesteps",
        args: {STEPS: 10},
      }),
    ).toBe("10歩動いた");
  });

  it("uses evaluated reporter values in move steps", () => {
    expect(
      describeTraceSnapshot({
        opcode: "motion_movesteps",
        args: {STEPS: 25},
      }),
    ).toBe("25歩動いた");
  });

  it("describes non-bounce edge check as いいえ", () => {
    expect(
      describeTraceSnapshot({
        opcode: "motion_ifonedgebounce",
        args: {},
        before: {direction: 90},
        after: {direction: 90},
        control: {bounced: false},
      }),
    ).toBe("端で跳ね返った？ → いいえ");
  });

  it("describes bounce with direction change", () => {
    expect(
      describeTraceSnapshot({
        opcode: "motion_ifonedgebounce",
        args: {},
        before: {direction: -90},
        after: {direction: 90},
        control: {bounced: true},
      }),
    ).toBe("端で跳ね返った？ → はい（向き -90° → 90°）");
  });

  it("distinguishes forever first visit and loop back", () => {
    expect(
      describeTraceSnapshot({
        opcode: "control_forever",
        args: {},
        control: {firstVisit: true},
      }),
    ).toBe("「ずっと」を開始した");
    expect(
      describeTraceSnapshot({
        opcode: "control_forever",
        args: {},
        control: {firstVisit: false, iteration: 2},
      }),
    ).toBe("「ずっと」の先頭に戻った");
  });

  it("describes if true branch", () => {
    expect(
      describeTraceSnapshot({
        opcode: "control_if",
        args: {CONDITION: true},
        control: {branch: 1, conditionText: "端に触れた"},
      }),
    ).toBe("条件「端に触れた」→ はい。「なら」の中へ進んだ");
  });

  it("describes if false branch", () => {
    expect(
      describeTraceSnapshot({
        opcode: "control_if",
        args: {CONDITION: false},
        control: {branch: 0, conditionText: "端に触れた"},
      }),
    ).toBe("条件「端に触れた」→ いいえ。「なら」をスキップした");
  });

  it("does not assert results for unknown extension opcodes", () => {
    indexBlockTemplates([
      {type: "music_playDrumForBeats", message0: "ドラム %1 を %2 拍鳴らす"},
    ]);
    const text = describeTraceSnapshot({
      opcode: "music_playDrumForBeats",
      displayTemplate: lookupBlockTemplate("music_playDrumForBeats"),
      args: {DRUM: "スネア", BEATS: 1},
    });
    expect(text).toContain("を実行した");
    expect(text).not.toMatch(/鳴らした$/);
  });

  it("keeps frozen snapshot text after hypothetical edits", () => {
    const snapshot: TraceSemanticSnapshot = {
      opcode: "motion_movesteps",
      displayTemplate: "%1 歩動かす",
      args: {STEPS: 10},
    };
    const first = describeTraceSnapshot(snapshot);
    snapshot.args.STEPS = 99;
    snapshot.opcode = "motion_turnright";
    expect(first).toBe("10歩動いた");
    expect(describeTraceSnapshot({opcode: "motion_turnright", args: {DEGREES: 99}})).toBe(
      "99度右に回った",
    );
  });
});

describe("motion_ifonedgebounce capture", () => {
  it("detects bounce from direction delta", () => {
    const descriptor = getTraceDescriptor("motion_ifonedgebounce")!;
    const util: TraceBlockUtilLike = {
      target: {direction: 90, x: 0, y: 0},
    };
    const before = descriptor.captureBefore?.({}, util, createTraceDescriptorContext());
    const utilAfter: TraceBlockUtilLike = {
      target: {direction: -90, x: 0, y: 0},
    };
    descriptor.captureAfter?.({}, utilAfter, before, undefined, createTraceDescriptorContext());
    const control = descriptor.enrichControl?.({}, utilAfter, before, createTraceDescriptorContext());
    expect(control?.bounced).toBe(true);
  });
});

describe("core opcode coverage", () => {
  it("covers every corpus opcode with descriptor or safe fallback", () => {
    indexBlockTemplates([]);
    expect(() => assertAllCoreOpcodesCovered()).not.toThrow();
    expect(allowedOpcodeSet().size).toBeGreaterThan(100);
  });

  it("has dedicated descriptors for key learner opcodes", () => {
    expect(traceDescriptorsForTest.event_whenflagclicked).toBeDefined();
    expect(traceDescriptorsForTest.motion_movesteps).toBeDefined();
    expect(traceDescriptorsForTest.motion_ifonedgebounce).toBeDefined();
    expect(traceDescriptorsForTest.control_forever).toBeDefined();
    expect(traceDescriptorsForTest.control_if).toBeDefined();
  });
});
