import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";
import {
  applyChromeLeftWidth,
  applyMenuSlotWidth,
  DEFAULT_MENU_SLOT_PX,
  measureChromeLeftWidth,
  measureScratchPrimaryMenuWidth,
  MENU_SLOT_GAP_PX,
  syncSyncratchChromeLayout,
  SYNCRATCH_CHROME_LEFT_VAR,
  SYNCRATCH_MENU_SLOT_VAR,
} from "./unified-chrome.js";

const styleCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "style.css"),
  "utf8",
);

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

function fakeEl(left: number, right: number): HTMLElement {
  return {
    getBoundingClientRect: () => ({left, right, width: right - left}),
  } as unknown as HTMLElement;
}

describe("unified chrome layout", () => {
  it("publishes the left chrome and menu-slot widths as CSS variables", () => {
    const root = fakeRoot();
    const chromeLeft = {
      getBoundingClientRect: () => ({width: 420.4}),
    } as unknown as HTMLElement;
    expect(measureChromeLeftWidth(chromeLeft)).toBe(421);

    const settings = fakeEl(100, 200);
    const file = fakeEl(200, 350);
    const edit = fakeEl(350, 500);
    const byLabel = (label: string) => {
      if (label === "設定メニュー" || label === "Settings menu") return settings;
      if (label === "ファイルメニュー" || label === "File menu") return file;
      if (label === "編集メニュー" || label === "Edit menu") return edit;
      return null;
    };
    const banner = {
      querySelector(selector: string) {
        const match = /\[aria-label="([^"]+)"\]/.exec(selector);
        return match ? byLabel(match[1]!) : null;
      },
    } as unknown as HTMLElement;
    const guiHost = {
      querySelector(selector: string) {
        if (selector.startsWith("header") || selector.includes("menu-bar_menu-bar_")) {
          return banner;
        }
        return null;
      },
    } as unknown as HTMLElement;

    const result = syncSyncratchChromeLayout({
      root,
      chromeLeft,
      guiHost,
    });
    expect(result.chromeLeft).toBe(421);
    expect(result.menuSlot).toBe(500 - 100 + MENU_SLOT_GAP_PX);
    expect(root.style.getPropertyValue(SYNCRATCH_CHROME_LEFT_VAR)).toBe(
      "421px",
    );
    expect(root.style.getPropertyValue(SYNCRATCH_MENU_SLOT_VAR)).toBe(
      `${500 - 100 + MENU_SLOT_GAP_PX}px`,
    );
  });

  it("falls back when Scratch menus are missing", () => {
    const root = fakeRoot();
    applyChromeLeftWidth(root, 100);
    applyMenuSlotWidth(root, 50);
    const result = syncSyncratchChromeLayout({
      root,
      chromeLeft: null,
      guiHost: null,
    });
    expect(result.chromeLeft).toBe(0);
    expect(result.menuSlot).toBe(DEFAULT_MENU_SLOT_PX);
    expect(root.style.getPropertyValue(SYNCRATCH_CHROME_LEFT_VAR)).toBe("0px");
    expect(root.style.getPropertyValue(SYNCRATCH_MENU_SLOT_VAR)).toBe(
      `${DEFAULT_MENU_SLOT_PX}px`,
    );
  });

  it("clamps negative widths to zero", () => {
    const root = fakeRoot();
    applyChromeLeftWidth(root, -12);
    applyMenuSlotWidth(root, -4);
    expect(root.style.getPropertyValue(SYNCRATCH_CHROME_LEFT_VAR)).toBe("0px");
    expect(root.style.getPropertyValue(SYNCRATCH_MENU_SLOT_VAR)).toBe("0px");
  });

  it("uses the default slot when only a file-group exists", () => {
    const fileGroup = fakeEl(0, 200);
    const banner = {
      querySelector(selector: string) {
        if (selector.includes("file-group")) return fileGroup;
        return null;
      },
    } as unknown as HTMLElement;
    const guiHost = {
      querySelector(selector: string) {
        if (selector.includes("banner") || selector.includes("menu-bar")) {
          return banner;
        }
        return null;
      },
    } as unknown as HTMLElement;
    expect(measureScratchPrimaryMenuWidth(guiHost)).toBe(
      DEFAULT_MENU_SLOT_PX,
    );
  });

  it("hides Scratch-native 設定/ファイル/編集 in favor of Syncratch menus", () => {
    expect(styleCss).toContain('aria-label="設定メニュー"');
    expect(styleCss).toContain('aria-label="ファイルメニュー"');
    expect(styleCss).toContain('aria-label="編集メニュー"');
    expect(styleCss).toMatch(
      /#scratch-gui button\[aria-label="設定メニュー"\][\s\S]*?display:\s*none\s*!important/,
    );
    expect(styleCss).toMatch(
      /\.toolbar\s+\.primary-controls\s*\{[^}]*pointer-events:\s*none/s,
    );
    expect(styleCss).toMatch(
      /\.toolbar\s+\.feature-panels[\s\S]*?pointer-events:\s*auto/,
    );
  });
});
