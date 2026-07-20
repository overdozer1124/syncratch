import {describe, expect, it, vi} from "vitest";
import {createProjectSessionTracker} from "./project-session.js";

describe("project session tracking", () => {
  it("does not apply an old in-flight save after switching projects", async () => {
    const sessions = createProjectSessionTracker();
    const oldSession = sessions.begin();
    let current = "old";
    let resolveSave!: (saved: string) => void;
    const deferredSave = new Promise<string>(resolve => {
      resolveSave = resolve;
    });
    const applyOldSave = deferredSave.then(saved => {
      sessions.runIfActive(oldSession, () => {
        current = saved;
      });
    });

    const newSession = sessions.begin();
    current = "new";
    const newStatus = vi.fn();
    const oldStatus = vi.fn();
    sessions.runIfActive(oldSession, oldStatus);
    sessions.runIfActive(newSession, newStatus);
    resolveSave("old-saved");
    await applyOldSave;

    expect(current).toBe("new");
    expect(oldStatus).not.toHaveBeenCalled();
    expect(newStatus).toHaveBeenCalledOnce();
  });

  it("serializes persistence and skips stale queued work", async () => {
    const sessions = createProjectSessionTracker();
    const oldSession = sessions.begin();
    let finishOld!: () => void;
    const oldGate = new Promise<void>(resolve => {
      finishOld = resolve;
    });
    const started: string[] = [];
    const committed: string[] = [];
    let concurrent = 0;
    let maxConcurrent = 0;

    const oldInFlight = sessions.runSerialized(oldSession, async isActive => {
      started.push("old-in-flight");
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await oldGate;
      concurrent -= 1;
      if (isActive()) committed.push("old-in-flight");
    });
    await vi.waitFor(() => expect(started).toEqual(["old-in-flight"]));
    const staleQueued = sessions.runSerialized(oldSession, async () => {
      started.push("old-queued");
    });
    const newSession = sessions.begin();
    const current = sessions.runSerialized(newSession, async isActive => {
      started.push("new");
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      if (isActive()) committed.push("new");
      concurrent -= 1;
    });

    finishOld();
    await Promise.all([oldInFlight, staleQueued, current]);

    expect(started).toEqual(["old-in-flight", "new"]);
    expect(committed).toEqual(["new"]);
    expect(maxConcurrent).toBe(1);
  });
});
