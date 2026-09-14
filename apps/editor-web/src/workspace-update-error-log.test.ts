import {afterEach, describe, expect, it, vi} from "vitest";
import {
  clearLastWorkspaceUpdateError,
  extractWorkspaceUpdateError,
  getLastWorkspaceUpdateError,
  installWorkspaceUpdateErrorCapture,
} from "./workspace-update-error-log.js";

afterEach(() => {
  clearLastWorkspaceUpdateError();
});

describe("extractWorkspaceUpdateError", () => {
  it("finds the marked message in a string argument", () => {
    expect(
      extractWorkspaceUpdateError([
        "2026.09.14 01:00:00 ERROR scratch-gui Workspace Update Error: bad xml",
      ]),
    ).toBe("Workspace Update Error: bad xml");
  });

  it("finds it on an Error and on a plain object with a message", () => {
    expect(
      extractWorkspaceUpdateError([
        new Error("Workspace Update Error: missing block"),
      ]),
    ).toBe("Workspace Update Error: missing block");
    expect(
      extractWorkspaceUpdateError([
        {message: "Workspace Update Error: bad shadow"},
      ]),
    ).toBe("Workspace Update Error: bad shadow");
  });

  it("ignores unrelated logging", () => {
    expect(extractWorkspaceUpdateError(["loaded project", 42, null])).toBeNull();
  });

  it("caps a runaway message", () => {
    const message = extractWorkspaceUpdateError([
      `Workspace Update Error: ${"x".repeat(5000)}`,
    ]);
    expect(message).not.toBeNull();
    expect(message!.length).toBeLessThanOrEqual(500);
  });
});

describe("installWorkspaceUpdateErrorCapture", () => {
  // scratch-gui logs through tslog, whose browser transport writes to
  // console.log rather than console.error — capturing only console.error would
  // silently miss every one of these.
  it("captures from console.log as well as console.error", () => {
    const log = vi.fn();
    const error = vi.fn();
    const fake = {log, error};
    const dispose = installWorkspaceUpdateErrorCapture(fake, () => 10);

    fake.log!("Workspace Update Error: from log");
    expect(getLastWorkspaceUpdateError()).toEqual({
      message: "Workspace Update Error: from log",
      at: 10,
    });

    fake.error!("Workspace Update Error: from error");
    expect(getLastWorkspaceUpdateError()?.message).toBe(
      "Workspace Update Error: from error",
    );

    dispose();
    expect(log).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("keeps the most recent one and forwards every call through", () => {
    const log = vi.fn();
    let clock = 0;
    const fake = {log, error: vi.fn()};
    const dispose = installWorkspaceUpdateErrorCapture(fake, () => (clock += 1));

    fake.log!("Workspace Update Error: first");
    fake.log!("something unrelated");
    fake.log!("Workspace Update Error: second");

    // The clock is only read on a match, so the unrelated line does not tick it.
    expect(getLastWorkspaceUpdateError()).toEqual({
      message: "Workspace Update Error: second",
      at: 2,
    });
    expect(log).toHaveBeenCalledTimes(3);
    dispose();
  });

  it("restores the originals on dispose", () => {
    const log = vi.fn();
    const error = vi.fn();
    const fake = {log, error};
    const dispose = installWorkspaceUpdateErrorCapture(fake, () => 0);
    expect(fake.log).not.toBe(log);
    dispose();
    expect(fake.log).toBe(log);
    expect(fake.error).toBe(error);
  });

  it("never lets a diagnostic break logging", () => {
    const log = vi.fn();
    const fake = {log, error: vi.fn()};
    const dispose = installWorkspaceUpdateErrorCapture(fake, () => {
      throw new Error("clock exploded");
    });

    const hostile = {
      get message() {
        throw new Error("nope");
      },
    };
    expect(() => fake.log!("Workspace Update Error: x", hostile)).not.toThrow();
    expect(log).toHaveBeenCalledTimes(1);
    dispose();
  });
});
