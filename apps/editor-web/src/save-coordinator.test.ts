import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createSaveCoordinator} from "./save-coordinator.js";

describe("save coordinator", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces edits into one save", async () => {
    const save = vi.fn(async () => undefined);
    const coordinator = createSaveCoordinator({
      debounceMs: 100,
      save,
    });

    coordinator.markDirty();
    coordinator.markDirty();
    await vi.advanceTimersByTimeAsync(100);

    expect(save).toHaveBeenCalledTimes(1);
    expect(coordinator.getState()).toBe("clean");
  });

  it("does not mark a newer generation clean when an older save finishes", async () => {
    let finishFirst!: () => void;
    const firstSave = new Promise<void>(resolve => {
      finishFirst = resolve;
    });
    const save = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValue(undefined);
    const coordinator = createSaveCoordinator({
      debounceMs: 100,
      save,
    });

    coordinator.markDirty();
    await vi.advanceTimersByTimeAsync(100);
    expect(coordinator.getState()).toBe("saving");
    coordinator.markDirty();
    finishFirst();
    await Promise.resolve();
    await Promise.resolve();

    expect(coordinator.getState()).toBe("dirty");
    await vi.advanceTimersByTimeAsync(100);
    expect(save).toHaveBeenCalledTimes(2);
    expect(coordinator.getState()).toBe("clean");
  });

  it("reports conflicts without retrying automatically", async () => {
    const conflict = Object.assign(new Error("stale"), {
      code: "STALE_REVISION",
    });
    const save = vi.fn(async () => {
      throw conflict;
    });
    const coordinator = createSaveCoordinator({
      debounceMs: 10,
      save,
    });

    coordinator.markDirty();
    await vi.advanceTimersByTimeAsync(10);
    await Promise.resolve();

    expect(coordinator.getState()).toBe("conflict");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(save).toHaveBeenCalledTimes(1);
  });
});
