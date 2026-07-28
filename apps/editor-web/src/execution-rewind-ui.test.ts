/** @vitest-environment jsdom */
import {describe, expect, it} from "vitest";
import type {RewindSnapshot} from "./execution-rewind-types.js";
import {
  formatRewindButtonLabel,
  formatRewindButtonTitle,
  formatScrubSliderAriaValueText,
  formatScrubSliderLabel,
  shouldNotifyRewindUnavailable,
} from "./execution-rewind-ui.js";

function snapshot(overrides: Partial<RewindSnapshot> = {}): RewindSnapshot {
  return {
    canScrub: true,
    playbackFrameIndex: 2,
    recordFrontierFrameIndex: 2,
    scrubDepthForward: 0,
    scrubDepthBack: 2,
    canRewind: true,
    rewindDepth: 2,
    isReplaying: false,
    rewindError: null,
    unsupportedOpcodes: [],
    ...overrides,
  };
}

describe("execution-rewind-ui", () => {
  it("shows rewind depth in the button title", () => {
    expect(formatRewindButtonTitle(snapshot({scrubDepthBack: 3}))).toBe(
      "1コマ戻る (3コマ)",
    );
  });

  it("includes unsupported opcodes in the disabled title", () => {
    expect(
      formatRewindButtonTitle(
        snapshot({
          canScrub: false,
          canRewind: false,
          scrubDepthBack: 0,
          rewindError: "この実行は正確に巻き戻せません",
          unsupportedOpcodes: ["event_broadcastandwait"],
        }),
      ),
    ).toBe("この実行は正確に巻き戻せません (event_broadcastandwait)");
  });

  it("formats the visible label with depth", () => {
    expect(formatRewindButtonLabel(snapshot({scrubDepthBack: 2}))).toBe(
      "戻る (2)",
    );
  });

  it("formats scrub slider labels", () => {
    expect(formatScrubSliderLabel(snapshot())).toBe("2 / 2");
    expect(formatScrubSliderAriaValueText(snapshot())).toBe("コマ 2 / 2");
  });

  it("detects rewind availability loss", () => {
    const previous = snapshot();
    const next = snapshot({
      canScrub: false,
      canRewind: false,
      scrubDepthBack: 0,
      rewindError: "この実行は正確に巻き戻せません",
      unsupportedOpcodes: ["music_playDrumForBeats"],
    });
    expect(shouldNotifyRewindUnavailable(previous, next)).toBe(true);
    expect(shouldNotifyRewindUnavailable(next, next)).toBe(false);
  });
});
