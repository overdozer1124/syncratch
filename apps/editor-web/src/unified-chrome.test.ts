import {describe, expect, it} from "vitest";
import {
  applyChromeLeftWidth,
  measureChromeLeftWidth,
  syncSyncratchChromeLeft,
  SYNCRATCH_CHROME_LEFT_VAR,
} from "./unified-chrome.js";

function fakeRoot(): HTMLElement {
  const props = new Map<string, string>();
  return {
    style: {
      setProperty(name: string, value: string) {
        props.set(name, value);
      },
      getPropertyValue(name: string) {
        return props.get(name) ?? "";
      },
      removeProperty(name: string) {
        props.delete(name);
      },
    },
  } as unknown as HTMLElement;
}

describe("unified chrome layout", () => {
  it("publishes the left chrome width as a CSS variable", () => {
    const root = fakeRoot();
    const chromeLeft = {
      getBoundingClientRect: () => ({width: 420.4}),
    } as unknown as HTMLElement;
    expect(measureChromeLeftWidth(chromeLeft)).toBe(421);
    expect(syncSyncratchChromeLeft({root, chromeLeft})).toBe(421);
    expect(root.style.getPropertyValue(SYNCRATCH_CHROME_LEFT_VAR)).toBe(
      "421px",
    );
  });

  it("clears the offset when chrome is missing", () => {
    const root = fakeRoot();
    applyChromeLeftWidth(root, 100);
    syncSyncratchChromeLeft({root, chromeLeft: null});
    expect(root.style.getPropertyValue(SYNCRATCH_CHROME_LEFT_VAR)).toBe("0px");
  });

  it("clamps negative widths to zero", () => {
    const root = fakeRoot();
    applyChromeLeftWidth(root, -12);
    expect(root.style.getPropertyValue(SYNCRATCH_CHROME_LEFT_VAR)).toBe("0px");
  });
});
