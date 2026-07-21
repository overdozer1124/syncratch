import {describe, expect, it} from "vitest";
import {
  driveConflictAction,
  shouldLatchDriveOverwriteConfirmation,
} from "./drive-conflict-status.js";

describe("driveConflictAction", () => {
  it("reports conflicts and clears stale conflict when Drive disconnects", () => {
    expect(driveConflictAction("conflict")).toBe("report");
    expect(driveConflictAction("synced")).toBe("clear");
    expect(driveConflictAction("disconnected")).toBe("clear");
    expect(driveConflictAction("not-configured")).toBe("clear");
    expect(driveConflictAction("syncing")).toBe("none");
  });
});

describe("shouldLatchDriveOverwriteConfirmation", () => {
  it("latches only when leaving an active Drive conflict via disconnect", () => {
    expect(
      shouldLatchDriveOverwriteConfirmation("conflict", "disconnected"),
    ).toBe(true);
    expect(
      shouldLatchDriveOverwriteConfirmation("conflict", "not-configured"),
    ).toBe(true);
    expect(shouldLatchDriveOverwriteConfirmation("conflict", "synced")).toBe(
      false,
    );
    expect(
      shouldLatchDriveOverwriteConfirmation("unsynced", "disconnected"),
    ).toBe(false);
  });
});
