import {describe, expect, it} from "vitest";
import {
  describeOpcodeInJapanese,
  fallbackJapaneseLabel,
  localizeTraceArgValue,
} from "./execution-trace-ja.js";
import {describeTraceSnapshot} from "./execution-trace-format.js";

describe("localizeTraceArgValue", () => {
  it("maps rotation-style menu ids to Japanese", () => {
    expect(localizeTraceArgValue("STYLE", "left-right")).toBe("左右のみ");
    expect(localizeTraceArgValue("STYLE", "don't rotate")).toBe("回転しない");
    expect(localizeTraceArgValue("STYLE", "all around")).toBe("自由に回転");
  });

  it("maps stop options to Japanese", () => {
    expect(localizeTraceArgValue("STOP_OPTION", "all")).toBe("すべて");
    expect(localizeTraceArgValue("STOP_OPTION", "this script")).toBe(
      "このスクリプト",
    );
  });
});

describe("describeOpcodeInJapanese", () => {
  it("describes motion_setrotationstyle in Japanese past tense", () => {
    expect(
      describeOpcodeInJapanese({
        opcode: "motion_setrotationstyle",
        args: {STYLE: "left-right"},
      }),
    ).toBe("回転方法を左右のみにした");
  });
});

describe("describeTraceSnapshot Japanese learner labels", () => {
  it("does not expose English opcode or STYLE=left-right for rotation style", () => {
    const text = describeTraceSnapshot({
      opcode: "motion_setrotationstyle",
      args: {STYLE: "left-right"},
    });
    expect(text).toBe("回転方法を左右のみにした");
    expect(text).not.toMatch(/motion_setrotationstyle/);
    expect(text).not.toMatch(/left-right/);
    expect(text).not.toMatch(/STYLE=/);
  });

  it("localizes control_stop options", () => {
    expect(
      describeTraceSnapshot({
        opcode: "control_stop",
        args: {STOP_OPTION: "this script"},
      }),
    ).toBe("「このスクリプト」を止めた");
  });

  it("uses Japanese fallback labels when template is missing", () => {
    const text = describeTraceSnapshot({
      opcode: "looks_nextcostume",
      args: {},
    });
    expect(text).toBe("次のコスチュームにした");
    expect(text).not.toMatch(/looks_nextcostume/);
  });

  it("describes known music opcodes in Japanese without English dumps", () => {
    const text = describeTraceSnapshot({
      opcode: "music_playDrumForBeats",
      displayTemplate: "ドラム %1 を %2 拍鳴らす",
      args: {DRUM: "1", BEATS: 2},
    });
    expect(text).toBe("ドラムを 2 拍鳴らした");
    expect(text).not.toMatch(/入力:/);
    expect(text).not.toMatch(/DRUM=/);
    expect(text).not.toMatch(/music_playDrumForBeats/);
  });

  it("fills unknown-block Japanese templates with %1 placeholders", () => {
    const text = describeTraceSnapshot({
      opcode: "custom_ext_ping",
      displayTemplate: "ピン %1",
      args: {VALUE: "3"},
    });
    expect(text).toBe("「ピン 3」を実行した");
    expect(text).not.toMatch(/入力:/);
  });
});

describe("fallbackJapaneseLabel", () => {
  it("prefers opcode name map over raw ids", () => {
    expect(fallbackJapaneseLabel("motion_setrotationstyle", undefined)).toBe(
      "回転方法を決める",
    );
    expect(fallbackJapaneseLabel("totally_unknown_opcode_xyz", undefined)).toBe(
      "ブロック",
    );
  });
});
