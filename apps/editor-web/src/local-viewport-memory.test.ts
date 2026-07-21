import {describe, expect, it} from "vitest";
import {createLocalViewportMemory} from "./local-viewport-memory.js";

describe("local viewport memory", () => {
  it("isolates viewports by local project and document target id", () => {
    const memory = createLocalViewportMemory();
    memory.set("proj-a", "target-b", {scrollX: 48, scrollY: -36, scale: 1.1});
    memory.set("proj-a", "target-a", {scrollX: 0, scrollY: 0, scale: 0.675});
    memory.set("proj-b", "target-b", {scrollX: 9, scrollY: 9, scale: 2});

    expect(memory.get("proj-a", "target-b")).toEqual({
      scrollX: 48,
      scrollY: -36,
      scale: 1.1,
    });
    expect(memory.get("proj-a", "target-a")).toEqual({
      scrollX: 0,
      scrollY: 0,
      scale: 0.675,
    });
    expect(memory.get("proj-b", "target-b")).toEqual({
      scrollX: 9,
      scrollY: 9,
      scale: 2,
    });
    expect(memory.get("proj-a", "missing")).toBeNull();
  });

  it("clears one project without affecting another", () => {
    const memory = createLocalViewportMemory();
    memory.set("proj-a", "t1", {scrollX: 1, scrollY: 2, scale: 1});
    memory.set("proj-b", "t1", {scrollX: 3, scrollY: 4, scale: 1});
    memory.clearProject("proj-a");
    expect(memory.get("proj-a", "t1")).toBeNull();
    expect(memory.get("proj-b", "t1")).toEqual({
      scrollX: 3,
      scrollY: 4,
      scale: 1,
    });
  });

  it("stores intentional default viewports and overwrites older non-defaults", () => {
    const memory = createLocalViewportMemory();
    memory.set("proj", "t", {scrollX: 48, scrollY: -36, scale: 1.1});
    memory.set("proj", "t", {scrollX: 0, scrollY: 0, scale: 0.675});
    expect(memory.get("proj", "t")).toEqual({
      scrollX: 0,
      scrollY: 0,
      scale: 0.675,
    });
  });

  it("tracks whether a viewport write was trusted or from Redux", () => {
    const memory = createLocalViewportMemory();
    memory.set("proj", "t", {scrollX: 1, scrollY: 2, scale: 1}, "trusted");
    expect(memory.getEntry("proj", "t")?.source).toBe("trusted");
    memory.set("proj", "t", {scrollX: 3, scrollY: 4, scale: 1}, "redux");
    expect(memory.getEntry("proj", "t")?.source).toBe("redux");
  });
});
