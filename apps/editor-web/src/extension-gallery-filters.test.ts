import {describe, expect, it} from "vitest";
import {buildExtensionGalleryItems} from "./extension-gallery.js";
import {
  countItemsForFilter,
  EXTENSION_GALLERY_FILTERS,
  filterExtensionGalleryItems,
  filterMatchesItem,
} from "./extension-gallery-filters.js";

describe("extension gallery filters", () => {
  const items = buildExtensionGalleryItems();

  it("lists the expected filter tabs", () => {
    expect(EXTENSION_GALLERY_FILTERS.map(filter => filter.id)).toEqual([
      "all",
      "scratch",
      "xcratch",
      "turbowarp",
      "stretch3",
    ]);
  });

  it("matches items by catalog source", () => {
    const fetchItem = items.find(item => item.extensionId === "fetch")!;
    expect(filterMatchesItem({id: "all", label: "すべて", source: null}, fetchItem)).toBe(
      true,
    );
    expect(
      filterMatchesItem(
        {id: "turbowarp", label: "TurboWarp", source: "turbowarp"},
        fetchItem,
      ),
    ).toBe(true);
    expect(
      filterMatchesItem(
        {id: "xcratch", label: "Xcratch", source: "xcratch"},
        fetchItem,
      ),
    ).toBe(false);
  });

  it("keeps shared Scratch builtins visible under Scratch and Xcratch", () => {
    const music = items.find(item => item.extensionId === "music")!;
    expect(music.sources).toEqual(
      expect.arrayContaining(["scratch-foundation", "xcratch", "stretch3"]),
    );
    expect(
      filterExtensionGalleryItems(items, "scratch").some(
        item => item.extensionId === "music",
      ),
    ).toBe(true);
    expect(
      filterExtensionGalleryItems(items, "xcratch").some(
        item => item.extensionId === "music",
      ),
    ).toBe(true);
    expect(
      filterExtensionGalleryItems(items, "turbowarp").some(
        item => item.extensionId === "music",
      ),
    ).toBe(false);
  });

  it("counts each filter without exceeding the full catalog", () => {
    const all = countItemsForFilter(items, "all");
    expect(all).toBe(items.length);
    expect(countItemsForFilter(items, "turbowarp")).toBeGreaterThan(0);
    expect(countItemsForFilter(items, "turbowarp")).toBeLessThan(all);
    expect(countItemsForFilter(items, "xcratch")).toBeGreaterThan(0);
  });
});
