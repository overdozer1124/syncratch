import {describe, expect, it} from "vitest";
import {buildExtensionGalleryItems} from "./extension-gallery.js";
import {
  countItemsForFilter,
  EXTENSION_GALLERY_FILTERS,
  filterExtensionGalleryItems,
  filterMatchesItem,
  topicsForExtensionKey,
} from "./extension-gallery-filters.js";

describe("extension gallery topic filters", () => {
  const items = buildExtensionGalleryItems();

  it("lists use-case filter tabs", () => {
    expect(EXTENSION_GALLERY_FILTERS.map(filter => filter.id)).toEqual([
      "all",
      "ml",
      "sensing",
      "board",
      "design",
      "network",
      "sound",
      "other",
    ]);
  });

  it("assigns topics for representative extensions", () => {
    expect(topicsForExtensionKey("ml2scratch")).toEqual(["ml"]);
    expect(topicsForExtensionKey("gdxfor")).toEqual(["sensing"]);
    expect(topicsForExtensionKey("microbit")).toEqual(["board"]);
    expect(topicsForExtensionKey("betterpen")).toEqual(["design"]);
    expect(topicsForExtensionKey("fetch")).toEqual(["network"]);
    expect(topicsForExtensionKey("music")).toEqual(["sound"]);
    expect(topicsForExtensionKey("unknown-ext")).toEqual(["other"]);
  });

  it("matches items by topic and allows multi-topic membership", () => {
    const speech = items.find(item => item.extensionId === "speech2scratch")!;
    expect(speech.topics).toEqual(
      expect.arrayContaining(["sensing", "sound", "ml"]),
    );
    expect(
      filterMatchesItem({id: "ml", label: "機械学習・AI", topic: "ml"}, speech),
    ).toBe(true);
    expect(
      filterMatchesItem(
        {id: "sound", label: "サウンド・ことば", topic: "sound"},
        speech,
      ),
    ).toBe(true);
    expect(
      filterMatchesItem(
        {id: "board", label: "拡張ボード・ロボット", topic: "board"},
        speech,
      ),
    ).toBe(false);
  });

  it("shows ML tools under 機械学習・AI and boards under 拡張ボード", () => {
    const mlIds = filterExtensionGalleryItems(items, "ml").map(
      item => item.extensionId,
    );
    expect(mlIds).toEqual(
      expect.arrayContaining(["ml2scratch", "chatgpt2scratch", "xcxml"]),
    );
    expect(mlIds).not.toContain("microbit");

    const boardIds = filterExtensionGalleryItems(items, "board").map(
      item => item.extensionId,
    );
    expect(boardIds).toEqual(
      expect.arrayContaining(["microbit", "xcxArduino", "poweredup"]),
    );
    expect(boardIds).not.toContain("fetch");
  });

  it("counts each topic without exceeding the full catalog", () => {
    const all = countItemsForFilter(items, "all");
    expect(all).toBe(items.length);
    expect(countItemsForFilter(items, "ml")).toBeGreaterThan(0);
    expect(countItemsForFilter(items, "ml")).toBeLessThan(all);
    expect(countItemsForFilter(items, "board")).toBeGreaterThan(0);
    expect(countItemsForFilter(items, "design")).toBeGreaterThan(0);
    // Every catalog entry must land in at least one topic bucket via `other` fallback.
    const covered = new Set(
      EXTENSION_GALLERY_FILTERS.filter(filter => filter.topic).flatMap(filter =>
        filterExtensionGalleryItems(items, filter.id).map(item => item.key),
      ),
    );
    expect(covered.size).toBe(items.length);
  });
});
