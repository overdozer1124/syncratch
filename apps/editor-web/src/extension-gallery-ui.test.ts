/** @vitest-environment jsdom */
import {afterEach, describe, expect, it, vi} from "vitest";
import {createExtensionGalleryUi} from "./extension-gallery-ui.js";
import type {ExtensionVm} from "./extension-gallery.js";

describe("extension gallery UI", () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.body.className = "";
  });

  it("renders Scratch-style cards with icons", () => {
    const ui = createExtensionGalleryUi({
      getVm: () => null,
    });
    ui.open();
    const grid = document.querySelector("[data-testid='extension-gallery-grid']");
    expect(grid).toBeTruthy();
    const cards = grid?.querySelectorAll(".extension-gallery-card") ?? [];
    expect(cards.length).toBeGreaterThan(10);
    const music = [...cards].find(
      card => (card as HTMLElement).dataset.extensionKey === "music",
    ) as HTMLElement | undefined;
    expect(music).toBeTruthy();
    const icon = music?.querySelector<HTMLImageElement>(
      ".extension-gallery-card-icon",
    );
    expect(icon?.getAttribute("src")).toMatch(/extensions\/icons\/music\./);
    expect(document.body.classList.contains("syncratch-extension-gallery-open")).toBe(
      true,
    );
    ui.close();
    expect(document.body.classList.contains("syncratch-extension-gallery-open")).toBe(
      false,
    );
    ui.dispose();
  });

  it("loads a builtin extension on card click and reports success", async () => {
    const loadExtensionURL = vi.fn(async () => undefined);
    const vm = {
      extensionManager: {
        isExtensionLoaded: () => false,
        loadExtensionURL,
        _loadedExtensions: new Map(),
        _registerInternalExtension: vi.fn(),
      },
      runtime: {},
    } satisfies ExtensionVm;
    const onLoaded = vi.fn();
    const ui = createExtensionGalleryUi({
      getVm: () => vm,
      onLoaded,
    });
    ui.open();
    const music = document.querySelector<HTMLButtonElement>(
      "[data-extension-key='music']",
    );
    expect(music).toBeTruthy();
    music!.click();
    await vi.waitFor(() => {
      expect(loadExtensionURL).toHaveBeenCalledWith("music");
      expect(onLoaded).toHaveBeenCalledWith("music", false);
    });
    expect(ui.isOpen()).toBe(false);
    ui.dispose();
  });

  it("filters the grid when a category tab is selected", () => {
    const ui = createExtensionGalleryUi({
      getVm: () => null,
    });
    ui.open();
    const filters = document.querySelector(
      "[data-testid='extension-gallery-filters']",
    );
    expect(filters).toBeTruthy();
    const tabs = filters?.querySelectorAll(".extension-gallery-filter") ?? [];
    expect(tabs.length).toBeGreaterThanOrEqual(4);

    const turbowarp = [...tabs].find(
      tab => (tab as HTMLElement).dataset.filterId === "turbowarp",
    ) as HTMLButtonElement | undefined;
    expect(turbowarp).toBeTruthy();
    turbowarp!.click();

    expect(ui.getFilter()).toBe("turbowarp");
    const activeTurbowarp = document.querySelector<HTMLButtonElement>(
      ".extension-gallery-filter[data-filter-id='turbowarp']",
    );
    expect(activeTurbowarp?.classList.contains("is-active")).toBe(true);
    expect(activeTurbowarp?.getAttribute("aria-selected")).toBe("true");

    const cards = [
      ...document.querySelectorAll<HTMLElement>(".extension-gallery-card"),
    ];
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.some(card => card.dataset.extensionKey === "fetch")).toBe(
      true,
    );
    // Builtin Scratch music should not appear under TurboWarp-only filter.
    expect(cards.some(card => card.dataset.extensionKey === "music")).toBe(
      false,
    );

    ui.setFilter("all");
    expect(ui.getFilter()).toBe("all");
    expect(
      document.querySelectorAll(".extension-gallery-card").length,
    ).toBeGreaterThan(cards.length);
    ui.dispose();
  });

  it("surfaces load errors in the gallery status area", async () => {
    const vm = {
      extensionManager: {
        isExtensionLoaded: () => false,
        loadExtensionURL: vi.fn(async () => {
          throw new Error("boom");
        }),
        _loadedExtensions: new Map(),
        _registerInternalExtension: vi.fn(),
      },
      runtime: {},
    } satisfies ExtensionVm;
    const onError = vi.fn();
    const ui = createExtensionGalleryUi({
      getVm: () => vm,
      onError,
    });
    ui.open();
    document.querySelector<HTMLButtonElement>("[data-extension-key='music']")!.click();
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalled();
    });
    const status = document.querySelector("[data-testid='extension-gallery-status']");
    expect(status?.textContent).toContain("読み込めませんでした");
    expect(ui.isOpen()).toBe(true);
    ui.dispose();
  });
});
