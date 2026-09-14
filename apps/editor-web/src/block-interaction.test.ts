import {describe, expect, it, vi} from "vitest";
import {
  cancelScratchBlockGesture,
  decideRemoteApplyDuringInteraction,
  isScratchBlockInteractionActive,
  REMOTE_APPLY_RUNNING_RETRY_MS,
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

describe("decideRemoteApplyDuringInteraction while the project runs", () => {
  // A remote apply is a full vm.loadProject, which clears the runtime and
  // stops every thread. Reloading mid-run is what made the green flag and key
  // hats look dead during collaboration.
  it("defers while running", () => {
    expect(
      decideRemoteApplyDuringInteraction({
        interacting: false,
        running: true,
        waitedMs: 0,
      }),
    ).toEqual({action: "defer", delayMs: REMOTE_APPLY_RUNNING_RETRY_MS});
  });

  it("keeps deferring past the drag deadline, since a forever loop never ends", () => {
    expect(
      decideRemoteApplyDuringInteraction({
        interacting: true,
        running: true,
        waitedMs: 60 * 60 * 1000,
      }),
    ).toEqual({action: "defer", delayMs: REMOTE_APPLY_RUNNING_RETRY_MS});
  });

  it("applies as soon as the project stops", () => {
    expect(
      decideRemoteApplyDuringInteraction({
        interacting: false,
        running: false,
        waitedMs: 5_000,
      }),
    ).toEqual({action: "apply"});
  });

  it("leaves the bounded drag wait alone when nothing is running", () => {
    expect(
      decideRemoteApplyDuringInteraction({
        interacting: true,
        running: false,
        waitedMs: 8_000,
      }),
    ).toEqual({action: "cancel-then-apply"});
  });
});
