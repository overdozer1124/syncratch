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
});
