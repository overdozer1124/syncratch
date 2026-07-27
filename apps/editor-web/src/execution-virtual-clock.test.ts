import {afterEach, describe, expect, it, vi} from "vitest";
import {installVirtualClock} from "./execution-virtual-clock.js";

describe("installVirtualClock", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("freezes currentMSecs while paused", () => {
    let wall = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => wall);

    const runtime = {
      currentMSecs: 500,
      updateCurrentMSecs() {
        runtime.currentMSecs = Date.now();
      },
    };

    const clock = installVirtualClock(runtime)!;
    runtime.updateCurrentMSecs();
    expect(runtime.currentMSecs).toBe(1_000);

    clock.freeze();
    wall = 5_000;
    runtime.updateCurrentMSecs();
    expect(runtime.currentMSecs).toBe(1_000);

    clock.unfreeze();
    wall = 5_100;
    runtime.updateCurrentMSecs();
    expect(runtime.currentMSecs).toBe(1_100);

    clock.dispose();
  });

  it("freezes setTimeout callbacks while paused", () => {
    vi.useFakeTimers();

    const runtime = {
      currentMSecs: 0,
      updateCurrentMSecs() {
        runtime.currentMSecs = Date.now();
      },
    };
    const clock = installVirtualClock(runtime)!;
    const callback = vi.fn();

    setTimeout(callback, 1_000);
    clock.freeze();
    vi.advanceTimersByTime(5_000);
    expect(callback).not.toHaveBeenCalled();

    clock.unfreeze();
    vi.advanceTimersByTime(1_000);
    expect(callback).toHaveBeenCalledTimes(1);

    clock.dispose();
  });
});
