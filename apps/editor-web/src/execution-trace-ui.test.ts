/** @vitest-environment jsdom */
import {describe, expect, it} from "vitest";
import {
  createTraceListView,
  formatTraceLine,
  formatTraceLines,
  formatTraceTime,
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

const at = (h: number, m: number, s: number) => (value: number) =>
  new Date(2026, 0, 1, h, m, s, value % 1000);

describe("formatTraceLines", () => {
  it("lists oldest first without mutating the input", () => {
    const entries = [
      entry({blockId: "a", snapshot: {opcode: "event_whenflagclicked", args: {}}}),
      entry({blockId: "b", snapshot: {opcode: "motion_movesteps", args: {STEPS: 10}}}),
    ];
    const lines = formatTraceLines(entries, at(10, 0, 0));
    expect(lines.map(l => l.label)).toEqual([
      "緑の旗でスクリプトを開始した",
      "10歩動いた",
    ]);
    expect(entries.map(e => e.blockId)).toEqual(["a", "b"]);
  });
});

describe("formatTraceLine", () => {
  it("uses semantic snapshot labels", () => {
    const line = formatTraceLine(
      entry({snapshot: {opcode: "motion_movesteps", args: {STEPS: 15}}}),
      at(10, 0, 0),
    );
    expect(line.label).toBe("15歩動いた");
  });
});

describe("createTraceListView", () => {
  it("renders one line per entry in execution order", () => {
    const container = document.createElement("div");
    createTraceListView(container).render([
      entry({blockId: "a", snapshot: {opcode: "event_whenflagclicked", args: {}}}),
      entry({blockId: "b", snapshot: {opcode: "motion_movesteps", args: {STEPS: 4}}}),
    ]);

    const items = container.querySelectorAll(".trace-line");
    expect(items).toHaveLength(2);
    expect(items[0]?.querySelector(".trace-label")?.textContent).toBe(
      "緑の旗でスクリプトを開始した",
    );
    expect(items[1]?.querySelector(".trace-label")?.textContent).toBe("4歩動いた");
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

describe("formatTraceTime", () => {
  it("pads to HH:MM:SS", () => {
    expect(formatTraceTime(0, at(9, 5, 3))).toBe("09:05:03");
  });
});
