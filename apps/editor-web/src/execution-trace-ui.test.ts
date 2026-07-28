/** @vitest-environment jsdom */
import {describe, expect, it} from "vitest";
import {
  createTraceListView,
  formatTraceLine,
  formatTraceLines,
  formatTraceStep,
} from "./execution-trace-ui.js";
import type {ResolvedTraceEntry} from "./execution-trace.js";

function entry(overrides: Partial<ResolvedTraceEntry> = {}): ResolvedTraceEntry {
  return {
    blockId: "b1",
    targetId: "t1",
    targetName: "ネコ",
    time: 0,
    snapshot: {
      opcode: "motion_movesteps",
      args: {STEPS: 10},
    },
    ...overrides,
  };
}

describe("formatTraceLines", () => {
  it("lists oldest first with 1-based step numbers", () => {
    const entries = [
      entry({blockId: "a", snapshot: {opcode: "event_whenflagclicked", args: {}}}),
      entry({blockId: "b", snapshot: {opcode: "motion_movesteps", args: {STEPS: 10}}}),
    ];
    const lines = formatTraceLines(entries);
    expect(lines.map(l => l.step)).toEqual(["1", "2"]);
    expect(lines.map(l => l.label)).toEqual([
      "緑の旗でスクリプトを開始した",
      "10歩動いた",
    ]);
    expect(entries.map(e => e.blockId)).toEqual(["a", "b"]);
  });
});

describe("formatTraceLine", () => {
  it("uses semantic snapshot labels and the given step index", () => {
    const line = formatTraceLine(
      entry({snapshot: {opcode: "motion_movesteps", args: {STEPS: 15}}}),
      3,
    );
    expect(line.step).toBe("3");
    expect(line.label).toBe("15歩動いた");
  });
});

describe("createTraceListView", () => {
  it("renders one line per entry in execution order with step numbers", () => {
    const container = document.createElement("div");
    createTraceListView(container).render([
      entry({blockId: "a", snapshot: {opcode: "event_whenflagclicked", args: {}}}),
      entry({blockId: "b", snapshot: {opcode: "motion_movesteps", args: {STEPS: 4}}}),
    ]);

    const items = container.querySelectorAll(".trace-line");
    expect(items).toHaveLength(2);
    expect(items[0]?.querySelector(".trace-step")?.textContent).toBe("1");
    expect(items[1]?.querySelector(".trace-step")?.textContent).toBe("2");
    expect(items[0]?.querySelector(".trace-label")?.textContent).toBe(
      "緑の旗でスクリプトを開始した",
    );
    expect(items[1]?.querySelector(".trace-label")?.textContent).toBe("4歩動いた");
    expect(items[0]?.querySelector(".trace-time")).toBeNull();
    expect(items[0]?.querySelector(".trace-repeat")).toBeNull();
  });

  it("auto-scrolls only when already near the bottom", () => {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientHeight", {value: 100});
    Object.defineProperty(container, "scrollHeight", {
      get() {
        return this.children.length > 0 ? 400 : 100;
      },
    });
    container.scrollTop = 280;
    const view = createTraceListView(container);
    view.render([entry()]);
    expect(container.scrollTop).toBe(container.scrollHeight);

    container.scrollTop = 0;
    view.render([entry(), entry({blockId: "b"})]);
    expect(container.scrollTop).toBe(0);
  });

  it("writes entry text as text nodes, never as markup", () => {
    const container = document.createElement("div");
    createTraceListView(container).render([
      entry({
        targetName: "<b>x</b>",
        snapshot: {
          opcode: "looks_say",
          args: {MESSAGE: "<img>"},
        },
      }),
    ]);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector(".trace-label")?.textContent).toBe("「<img>」と言った");
  });
});

describe("formatTraceStep", () => {
  it("formats 1-based step numbers as plain digits", () => {
    expect(formatTraceStep(1)).toBe("1");
    expect(formatTraceStep(12)).toBe("12");
  });
});
