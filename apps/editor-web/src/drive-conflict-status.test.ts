import {describe, expect, it} from "vitest";
import {driveConflictAction} from "./drive-conflict-status.js";

describe("driveConflictAction", () => {
  it("reports conflicts and clears stale conflict when Drive disconnects", () => {
    expect(driveConflictAction("conflict")).toBe("report");
    expect(driveConflictAction("synced")).toBe("clear");
    expect(driveConflictAction("disconnected")).toBe("clear");
    expect(driveConflictAction("not-configured")).toBe("clear");
    expect(driveConflictAction("syncing")).toBe("none");
  });
});
