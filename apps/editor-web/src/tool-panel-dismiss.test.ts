import {describe, expect, it} from "vitest";
import {
  closeOpenToolPanels,
  shouldCloseToolPanelsOnKey,
  shouldCloseToolPanelsOnOutsideTarget,
} from "./tool-panel-dismiss.js";

function fakePanel(open: boolean, containsTarget: boolean): HTMLDetailsElement {
  return {
    open,
    contains: () => containsTarget,
  } as unknown as HTMLDetailsElement;
}

describe("tool panel dismiss", () => {
  it("closes on outside pointer targets and Escape", () => {
    const openPanel = fakePanel(true, false);
    const closedPanel = fakePanel(false, false);
    const outside = {} as EventTarget;

    expect(
      shouldCloseToolPanelsOnOutsideTarget(outside, [openPanel, closedPanel]),
    ).toBe(true);

    const insidePanel = fakePanel(true, true);
    expect(
      shouldCloseToolPanelsOnOutsideTarget(outside, [insidePanel]),
    ).toBe(false);

    expect(shouldCloseToolPanelsOnKey("Escape")).toBe(true);
    expect(shouldCloseToolPanelsOnKey("Enter")).toBe(false);

    openPanel.open = true;
    closeOpenToolPanels([openPanel, closedPanel]);
    expect(openPanel.open).toBe(false);
  });
});
