import {describe, expect, it, vi} from "vitest";
import {applyGuestInitialProject} from "./guest-project-apply.js";

describe("applyGuestInitialProject", () => {
  it("does not persist a candidate when VM loading fails", async () => {
    const events: string[] = [];
    const commit = vi.fn();

    await expect(applyGuestInitialProject({
      candidate: "guest",
      previous: "previous",
      isActive: () => true,
      load: async record => {
        events.push(`load:${record}`);
        if (record === "guest") throw new Error("VM load failed");
      },
      persist: async record => {
        events.push(`persist:${record}`);
        return record;
      },
      remove: async record => {
        events.push(`remove:${record}`);
      },
      commit,
      setSuppressed: value => events.push(`suppressed:${value}`),
    })).rejects.toThrow("VM load failed");

    expect(events).toEqual([
      "suppressed:true",
      "load:guest",
      "load:previous",
      "suppressed:false",
    ]);
    expect(commit).not.toHaveBeenCalled();
  });

  it("cancels after VM loading without persisting and restores the previous VM", async () => {
    const events: string[] = [];
    let active = true;
    const commit = vi.fn();

    const applied = await applyGuestInitialProject({
      candidate: "guest",
      previous: "previous",
      isActive: () => active,
      load: async record => {
        events.push(`load:${record}`);
        if (record === "guest") active = false;
      },
      persist: async record => {
        events.push(`persist:${record}`);
        return record;
      },
      remove: async record => {
        events.push(`remove:${record}`);
      },
      commit,
      setSuppressed: value => events.push(`suppressed:${value}`),
    });

    expect(applied).toBe(false);
    expect(events).toEqual([
      "suppressed:true",
      "load:guest",
      "load:previous",
      "suppressed:false",
    ]);
    expect(commit).not.toHaveBeenCalled();
  });

  it("removes a persisted candidate if cancellation races the write", async () => {
    const events: string[] = [];
    let active = true;
    const commit = vi.fn();

    const applied = await applyGuestInitialProject({
      candidate: "guest",
      previous: "previous",
      isActive: () => active,
      load: async record => {
        events.push(`load:${record}`);
      },
      persist: async record => {
        events.push(`persist:${record}`);
        active = false;
        return "saved";
      },
      remove: async record => {
        events.push(`remove:${record}`);
      },
      commit,
      setSuppressed: value => events.push(`suppressed:${value}`),
    });

    expect(applied).toBe(false);
    expect(events).toEqual([
      "suppressed:true",
      "load:guest",
      "persist:guest",
      "remove:saved",
      "load:previous",
      "suppressed:false",
    ]);
    expect(commit).not.toHaveBeenCalled();
  });

  it("restores the previous VM if persistence fails after loading", async () => {
    const events: string[] = [];
    const commit = vi.fn();

    await expect(applyGuestInitialProject({
      candidate: "guest",
      previous: "previous",
      isActive: () => true,
      load: async record => {
        events.push(`load:${record}`);
      },
      persist: async record => {
        events.push(`persist:${record}`);
        throw new Error("IndexedDB failed");
      },
      remove: async record => {
        events.push(`remove:${record}`);
      },
      commit,
      setSuppressed: value => events.push(`suppressed:${value}`),
    })).rejects.toThrow("IndexedDB failed");

    expect(events).toEqual([
      "suppressed:true",
      "load:guest",
      "persist:guest",
      "load:previous",
      "suppressed:false",
    ]);
    expect(commit).not.toHaveBeenCalled();
  });

  it("surfaces a failed previous-VM restore", async () => {
    await expect(applyGuestInitialProject({
      candidate: "guest",
      previous: "previous",
      isActive: () => true,
      load: async record => {
        if (record === "guest") throw new Error("candidate load failed");
        throw new Error("previous restore failed");
      },
      persist: async record => record,
      remove: async () => undefined,
      commit: vi.fn(),
      setSuppressed: vi.fn(),
    })).rejects.toThrow("previous restore failed");
  });

  it("surfaces cleanup failure after cancellation and still restores the VM", async () => {
    let active = true;
    const load = vi.fn(async () => undefined);

    await expect(applyGuestInitialProject({
      candidate: "guest",
      previous: "previous",
      isActive: () => active,
      load,
      persist: async () => {
        active = false;
        return "saved";
      },
      remove: async () => {
        throw new Error("cleanup failed");
      },
      commit: vi.fn(),
      setSuppressed: vi.fn(),
    })).rejects.toThrow("cleanup failed");

    expect(load).toHaveBeenCalledWith("previous");
  });

  it("persists and commits only after VM loading succeeds", async () => {
    const events: string[] = [];

    const applied = await applyGuestInitialProject({
      candidate: "guest",
      previous: "previous",
      isActive: () => true,
      load: async record => {
        events.push(`load:${record}`);
      },
      persist: async record => {
        events.push(`persist:${record}`);
        return "saved";
      },
      remove: async record => {
        events.push(`remove:${record}`);
      },
      commit: record => events.push(`commit:${record}`),
      setSuppressed: value => events.push(`suppressed:${value}`),
    });

    expect(applied).toBe(true);
    expect(events).toEqual([
      "suppressed:true",
      "load:guest",
      "persist:guest",
      "commit:saved",
      "suppressed:false",
    ]);
  });
});
