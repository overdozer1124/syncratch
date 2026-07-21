import {describe, expect, it, vi} from "vitest";
import {applyRemoteProjectUpdate} from "./apply-remote-update.js";

describe("applyRemoteProjectUpdate", () => {
  it("loads the remote project into the VM before persisting", async () => {
    const events: string[] = [];
    const commit = vi.fn();

    const result = await applyRemoteProjectUpdate({
      candidate: "remote",
      previous: "previous",
      isActive: () => true,
      load: async record => {
        events.push(`load:${record}`);
      },
      persist: async record => {
        events.push(`persist:${record}`);
        return `saved:${record}`;
      },
      commit,
      setSuppressed: value => events.push(`suppressed:${value}`),
    });

    expect(result).toEqual({applied: true, persisted: true});
    expect(events).toEqual([
      "suppressed:true",
      "load:remote",
      "persist:remote",
      "suppressed:false",
    ]);
    expect(commit).toHaveBeenCalledWith("saved:remote", {persisted: true});
  });

  it("keeps the remote VM state when persist fails", async () => {
    const events: string[] = [];
    const commit = vi.fn();
    const onPersistError = vi.fn();

    const result = await applyRemoteProjectUpdate({
      candidate: "remote",
      previous: "previous",
      isActive: () => true,
      load: async record => {
        events.push(`load:${record}`);
      },
      persist: async () => {
        events.push("persist");
        throw new Error("IndexedDB full");
      },
      commit,
      setSuppressed: value => events.push(`suppressed:${value}`),
      onPersistError,
    });

    expect(result).toEqual({applied: true, persisted: false});
    expect(events).toEqual([
      "suppressed:true",
      "load:remote",
      "persist",
      "suppressed:false",
    ]);
    expect(onPersistError).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith("remote", {persisted: false});
  });

  it("restores the previous VM when loading the remote project fails", async () => {
    const events: string[] = [];
    const commit = vi.fn();

    await expect(applyRemoteProjectUpdate({
      candidate: "remote",
      previous: "previous",
      isActive: () => true,
      load: async record => {
        events.push(`load:${record}`);
        if (record === "remote") throw new Error("load failed");
      },
      persist: async record => {
        events.push(`persist:${record}`);
        return record;
      },
      commit,
      setSuppressed: value => events.push(`suppressed:${value}`),
    })).rejects.toThrow("load failed");

    expect(events).toEqual([
      "suppressed:true",
      "load:remote",
      "suppressed:false",
    ]);
    expect(commit).not.toHaveBeenCalled();
  });

  it("cancels without persisting when the session ends after VM load", async () => {
    const events: string[] = [];
    let active = true;
    const commit = vi.fn();

    const result = await applyRemoteProjectUpdate({
      candidate: "remote",
      previous: "previous",
      isActive: () => active,
      load: async record => {
        events.push(`load:${record}`);
        if (record === "remote") active = false;
      },
      persist: async record => {
        events.push(`persist:${record}`);
        return record;
      },
      commit,
      setSuppressed: value => events.push(`suppressed:${value}`),
    });

    expect(result).toEqual({applied: false});
    expect(events).toEqual([
      "suppressed:true",
      "load:remote",
      "load:previous",
      "suppressed:false",
    ]);
    expect(commit).not.toHaveBeenCalled();
  });
});
