/** @vitest-environment jsdom */
import {describe, expect, it, vi} from "vitest";
import {createExtensionGalleryUi} from "./extension-gallery-ui.js";

describe("extension gallery UI", () => {
  it("renders catalog cards and closes on Escape", () => {
    const gallery = createExtensionGalleryUi({
      getVm: () => null,
      onError: vi.fn(),
    });
    gallery.open();
    const grid = document.querySelector("[data-testid='extension-gallery-grid']");
    expect(grid).toBeTruthy();
    expect(grid?.querySelectorAll(".extension-gallery-card").length).toBeGreaterThan(
      20,
    );
    expect(document.body.classList.contains("syncratch-extension-gallery-open")).toBe(
      true,
    );

    document.dispatchEvent(new KeyboardEvent("keydown", {key: "Escape"}));
    expect(gallery.isOpen()).toBe(false);
    expect(document.body.classList.contains("syncratch-extension-gallery-open")).toBe(
      false,
    );
    gallery.dispose();
  });
});
