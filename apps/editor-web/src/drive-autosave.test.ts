import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {
  createDriveAutosave,
  isDriveAutosaveEligible,
} from "./drive-autosave.js";

describe("isDriveAutosaveEligible", () => {
  it("allows only a connected, conflict-free leader with Drive access", () => {
    expect(isDriveAutosaveEligible({
      driveConnected: true,
      collaboration: {
        status: "connected",
        role: "leader",
        conflict: false,
      },
    })).toBe(true);

    for (const collaboration of [
      {status: "connected", role: "follower", conflict: false},
      {status: "disconnected", role: "leader", conflict: false},
      {status: "connected", role: "leader", conflict: true},
      null,
    ] as const) {
      expect(isDriveAutosaveEligible({
        driveConnected: true,
        collaboration,
      })).toBe(false);
    }

    expect(isDriveAutosaveEligible({
      driveConnected: false,
      collaboration: {
        status: "connected",
        role: "leader",
        conflict: false,
      },
    })).toBe(false);
  });
});

describe("Drive autosave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("debounces eligible edits into one save", async () => {
    const save = vi.fn(async () => true);
    const autosave = createDriveAutosave({
      delayMs: 2_000,
      isEligible: () => true,
      save,
    });

    autosave.noteChange();
    await vi.advanceTimersByTimeAsync(1_000);
    autosave.noteChange();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(save).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("does not schedule saves for an ineligible peer", async () => {
    const save = vi.fn(async () => true);
    const autosave = createDriveAutosave({
      delayMs: 2_000,
      isEligible: () => false,
      save,
    });

    autosave.noteChange();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(save).not.toHaveBeenCalled();
  });

  it("cancels a pending save when eligibility is lost", async () => {
    let eligible = true;
    const save = vi.fn(async () => true);
    const autosave = createDriveAutosave({
      delayMs: 2_000,
      isEligible: () => eligible,
      save,
    });

    autosave.noteChange();
    eligible = false;
    autosave.eligibilityChanged();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(save).not.toHaveBeenCalled();
  });

  it("runs one follow-up save when an edit arrives during a save", async () => {
    let finishFirst!: (saved: boolean) => void;
    const firstSave = new Promise<boolean>(resolve => {
      finishFirst = resolve;
    });
    const save = vi.fn()
      .mockImplementationOnce(() => firstSave)
      .mockResolvedValueOnce(true);
    const autosave = createDriveAutosave({
      delayMs: 2_000,
      isEligible: () => true,
      save,
    });

    autosave.noteChange();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(save).toHaveBeenCalledTimes(1);

    autosave.noteChange();
    finishFirst(true);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(save).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("does not retry a failed save without another edit", async () => {
    const save = vi.fn(async () => false);
    const autosave = createDriveAutosave({
      delayMs: 2_000,
      isEligible: () => true,
      save,
    });

    autosave.noteChange();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(save).toHaveBeenCalledTimes(1);
  });

  it("contains a rejected save and permits a later edit", async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error("unexpected save rejection"))
      .mockResolvedValueOnce(true);
    const autosave = createDriveAutosave({
      delayMs: 2_000,
      isEligible: () => true,
      save,
    });

    autosave.noteChange();
    await vi.advanceTimersByTimeAsync(2_000);
    autosave.noteChange();
    await vi.advanceTimersByTimeAsync(2_000);

    expect(save).toHaveBeenCalledTimes(2);
  });
});
