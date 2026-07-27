import {beforeEach, describe, expect, it} from "vitest";
import {
  armBlockEventDropNext,
  clearBlockEventDropHarness,
  getBlockEventDropLog,
  matchesDropKind,
  peekArmedBlockEventDrop,
} from "./blockly-event-drop-harness.js";

describe("blockly-event-drop-harness", () => {
  beforeEach(() => {
    clearBlockEventDropHarness();
  });

  it("arms and peeks the next drop kind", () => {
    expect(peekArmedBlockEventDrop()).toBeNull();
    armBlockEventDropNext("move");
    expect(peekArmedBlockEventDrop()).toBe("move");
  });

  it("matches delete, move, and connection-change events", () => {
    expect(matchesDropKind({type: "delete"}, "delete")).toBe(true);
    expect(
      matchesDropKind({type: "move", newCoordinate: {x: 0, y: 0}}, "move"),
    ).toBe(true);
    expect(
      matchesDropKind(
        {type: "move", oldParentId: "a", newParentId: "b"},
        "connection-change",
      ),
    ).toBe(true);
    expect(
      matchesDropKind({type: "move", newCoordinate: {x: 0, y: 0}}, "delete"),
    ).toBe(false);
  });

  it("starts with an empty drop log", () => {
    expect(getBlockEventDropLog()).toHaveLength(0);
  });
});
