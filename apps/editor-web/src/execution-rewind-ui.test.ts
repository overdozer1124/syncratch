/** @vitest-environment jsdom */
import {describe, expect, it} from "vitest";
import {
  formatRewindButtonLabel,
  formatRewindButtonTitle,
  isExecutionControlShortcutTarget,
  resolveExecutionControlShortcut,
  shouldNotifyRewindUnavailable,
} from "./execution-rewind-ui.js";

describe("execution-rewind-ui", () => {
  it("shows rewind depth in the button title", () => {
    expect(
      formatRewindButtonTitle({
        canRewind: true,
        rewindDepth: 3,
        isReplaying: false,
        rewindError: null,
        unsupportedOpcodes: [],
      }),
    ).toBe("1コマ戻る (3コマ)");
  });

  it("includes unsupported opcodes in the disabled title", () => {
    expect(
      formatRewindButtonTitle({
        canRewind: false,
        rewindDepth: 0,
        isReplaying: false,
        rewindError: "この実行は正確に巻き戻せません",
        unsupportedOpcodes: ["event_broadcastandwait"],
      }),
    ).toBe("この実行は正確に巻き戻せません (event_broadcastandwait)");
  });

  it("formats the visible label with depth", () => {
    expect(
      formatRewindButtonLabel({
        canRewind: true,
        rewindDepth: 2,
        isReplaying: false,
        rewindError: null,
        unsupportedOpcodes: [],
      }),
    ).toBe("戻る (2)");
  });

  it("detects rewind availability loss", () => {
    const previous = {
      canRewind: true,
      rewindDepth: 2,
      isReplaying: false,
      rewindError: null,
      unsupportedOpcodes: [],
    };
    const next = {
      canRewind: false,
      rewindDepth: 0,
      isReplaying: false,
      rewindError: "この実行は正確に巻き戻せません",
      unsupportedOpcodes: ["music_playDrumForBeats"],
    };
    expect(shouldNotifyRewindUnavailable(previous, next)).toBe(true);
    expect(shouldNotifyRewindUnavailable(next, next)).toBe(false);
  });

  it("maps keyboard shortcuts", () => {
    expect(resolveExecutionControlShortcut(" ", false)).toBe("pause");
    expect(resolveExecutionControlShortcut("[", false)).toBe("rewind");
    expect(resolveExecutionControlShortcut("]", false)).toBe("step");
    expect(resolveExecutionControlShortcut("[", true)).toBeNull();
  });

  it("ignores shortcut targets inside editable fields", () => {
    const input = document.createElement("input");
    expect(isExecutionControlShortcutTarget(input)).toBe(false);
    expect(isExecutionControlShortcutTarget(document.createElement("button"))).toBe(
      true,
    );
  });
});
