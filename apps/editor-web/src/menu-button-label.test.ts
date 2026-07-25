import {describe, expect, it} from "vitest";
import {setMenuButtonLabel} from "./menu-button-label.js";

describe("setMenuButtonLabel", () => {
  it("updates only the label span when an icon is present", () => {
    const state = {label: "旧"};
    const button = {
      textContent: "",
      querySelector(selector: string) {
        if (selector !== ".menu-item-label") return null;
        return {
          get textContent() {
            return state.label;
          },
          set textContent(value: string) {
            state.label = value;
          },
        };
      },
    } as unknown as HTMLElement;
    setMenuButtonLabel(button, "新ラベル");
    expect(state.label).toBe("新ラベル");
    expect(button.textContent).toBe("");
  });

  it("falls back to textContent when no label span exists", () => {
    const button = {
      textContent: "旧",
      querySelector() {
        return null;
      },
    } as unknown as HTMLElement;
    setMenuButtonLabel(button, "新");
    expect(button.textContent).toBe("新");
  });
});
