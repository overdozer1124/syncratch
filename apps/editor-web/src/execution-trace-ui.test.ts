/** @vitest-environment jsdom */
import {describe, expect, it} from "vitest";
import {
  createTraceListView,
  describeOpcode,
  formatTraceLine,
  formatTraceLines,
  formatTraceTime,
} from "./execution-trace-ui.js";
import type {ResolvedTraceEntry} from "./execution-trace.js";

function entry(
  overrides: Partial<ResolvedTraceEntry> = {},
): ResolvedTraceEntry {
  return {
    blockId: "b1",
    targetId: "t1",
    firstTime: 0,
    lastTime: 0,
    count: 1,
    opcode: "motion_movesteps",
    targetName: "ネコ",
    ...overrides,
  };
}

// Fixed local time so the assertion does not depend on the runner's timezone.
const at = (h: number, m: number, s: number) => (value: number) =>
  new Date(2026, 0, 1, h, m, s, value % 1000);

describe("formatTraceTime", () => {
  it("pads to HH:MM:SS", () => {
    expect(formatTraceTime(0, at(9, 5, 3))).toBe("09:05:03");
    expect(formatTraceTime(0, at(23, 59, 59))).toBe("23:59:59");
  });
});

describe("describeOpcode", () => {
  it("uses Japanese for known opcodes", () => {
    expect(describeOpcode("event_whenflagclicked")).toBe("緑の旗が押された");
    expect(describeOpcode("motion_movesteps")).toBe("歩いた");
  });

  it("falls back to the raw opcode rather than hiding the step", () => {
    expect(describeOpcode("sensing_touchingobject")).toBe(
      "sensing_touchingobject",
    );
  });

  it("marks a deleted block", () => {
    expect(describeOpcode(null)).toBe("（削除されたブロック）");
  });
});

describe("formatTraceLine", () => {
  it("shows a repeat marker only for coalesced runs", () => {
    expect(formatTraceLine(entry({count: 1}), at(10, 0, 0)).repeat).toBe("");
    expect(formatTraceLine(entry({count: 12}), at(10, 0, 0)).repeat).toBe("×12");
  });

  it("leaves the target blank when the sprite is gone", () => {
    expect(formatTraceLine(entry({targetName: null}), at(10, 0, 0)).target).toBe(
      "",
    );
  });

  it("uses the first execution time of a run", () => {
    const line = formatTraceLine(
      entry({firstTime: 5, lastTime: 900, count: 30}),
      at(10, 30, 0),
    );
    expect(line.time).toBe("10:30:00");
  });
});

describe("formatTraceLines", () => {
  it("lists newest first without mutating the input", () => {
    const entries = [
      entry({blockId: "a", opcode: "event_whenflagclicked"}),
      entry({blockId: "b", opcode: "motion_movesteps"}),
    ];
    const lines = formatTraceLines(entries, at(10, 0, 0));
    expect(lines.map(l => l.label)).toEqual(["歩いた", "緑の旗が押された"]);
    expect(entries.map(e => e.blockId)).toEqual(["a", "b"]);
  });
});

describe("createTraceListView", () => {
  it("renders one line per entry, newest first", () => {
    const container = document.createElement("div");
    createTraceListView(container).render([
      entry({blockId: "a", opcode: "event_whenflagclicked", count: 1}),
      entry({blockId: "b", opcode: "motion_movesteps", count: 4}),
    ]);

    const items = container.querySelectorAll(".trace-line");
    expect(items).toHaveLength(2);
    expect(items[0]?.querySelector(".trace-label")?.textContent).toBe("歩いた");
    expect(items[0]?.querySelector(".trace-repeat")?.textContent).toBe("×4");
    expect(items[1]?.querySelector(".trace-label")?.textContent).toBe(
      "緑の旗が押された",
    );
    expect(items[1]?.querySelector(".trace-repeat")).toBeNull();
  });

  it("shows an empty message when nothing has run", () => {
    const container = document.createElement("div");
    createTraceListView(container).render([]);
    expect(container.querySelector(".trace-empty")?.textContent).toBe(
      "まだ何も動いていません",
    );
  });

  it("replaces previous output on re-render", () => {
    const container = document.createElement("div");
    const view = createTraceListView(container);
    view.render([entry()]);
    view.render([entry(), entry({blockId: "b"})]);
    expect(container.querySelectorAll(".trace-line")).toHaveLength(2);
    expect(container.querySelectorAll(".trace-list")).toHaveLength(1);
  });

  it("writes entry text as text nodes, never as markup", () => {
    const container = document.createElement("div");
    createTraceListView(container).render([
      entry({opcode: "<img src=x onerror=alert(1)>", targetName: "<b>x</b>"}),
    ]);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector(".trace-label")?.textContent).toBe(
      "<img src=x onerror=alert(1)>",
    );
  });
});
