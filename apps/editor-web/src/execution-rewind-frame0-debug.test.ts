import {describe, expect, it} from "vitest";
import {createRewindVmHarness} from "./execution-rewind-vm-harness.js";

/** Left-edge bounds that trigger `motion_ifonedgebounce` in scratch-vm. */
function leftEdgeBounds() {
  return {
    left: -241,
    right: -201,
    top: -20,
    bottom: 20,
  };
}

describe("forever move+bounce rewind with renderer bounds", () => {
  it("rewinds when record used getBounds but replay does not", async () => {
    const harness = await createRewindVmHarness({
      foreverBounce: true,
      foreverBounceStep: 10,
    });
    const sprite = harness.findSprite();
    sprite.x = -230;
    sprite.y = 0;
    sprite.direction = 90;
    sprite.getBounds = leftEdgeBounds;

    harness.vm.greenFlag();
    for (let i = 0; i < 30; i += 1) {
      harness.vm.runtime._step?.();
    }
    harness.control.pause();

    delete (sprite as {getBounds?: unknown}).getBounds;

    const result = await harness.rewind.rewindFrame();
    expect(result.ok, result.error ?? undefined).toBe(true);

    harness.rewind.dispose();
    harness.trace.dispose();
    harness.control.dispose();
  }, 60_000);
});
