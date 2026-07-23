import {describe, expect, it, vi} from "vitest";
import {
  cancelScratchBlockGesture,
  decideRemoteApplyDuringInteraction,
  isScratchBlockInteractionActive,
} from "./block-interaction.js";

describe("isScratchBlockInteractionActive", () => {
  it("detects Blockly Gesture.inProgress and workspace.isDragging", () => {
    expect(
      isScratchBlockInteractionActive(null, {
        Gesture: {inProgress: () => true},
      }),
    ).toBe(true);
    expect(
      isScratchBlockInteractionActive(
        {isDragging: () => true},
        {Gesture: {inProgress: () => false}},
      ),
    ).toBe(true);
    expect(
      isScratchBlockInteractionActive(
        {isDragging: () => false},
        {Gesture: {inProgress: () => false}},
      ),
    ).toBe(false);
  });
});

describe("cancelScratchBlockGesture", () => {
  it("invokes cancelCurrentGesture when present", () => {
    const cancel = vi.fn();
    expect(cancelScratchBlockGesture({cancelCurrentGesture: cancel})).toBe(
      true,
    );
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancelScratchBlockGesture({})).toBe(false);
  });
});

describe("decideRemoteApplyDuringInteraction", () => {
  it("applies immediately when idle", () => {
    expect(
      decideRemoteApplyDuringInteraction({interacting: false, waitedMs: 0}),
    ).toEqual({action: "apply"});
  });

  it("defers while dragging until the max wait, then cancels", () => {
    expect(
      decideRemoteApplyDuringInteraction({interacting: true, waitedMs: 0}),
    ).toEqual({action: "defer", delayMs: 100});
    expect(
      decideRemoteApplyDuringInteraction({
        interacting: true,
        waitedMs: 8_000,
      }),
    ).toEqual({action: "cancel-then-apply"});
  });
});
