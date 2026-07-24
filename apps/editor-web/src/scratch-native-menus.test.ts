import {describe, expect, it, vi} from "vitest";
import {
  COLOR_MODE_HIGH_CONTRAST,
  listLocales,
  localeLabel,
  readColorMode,
  readLocale,
  readRestoreDeletion,
  readTurboMode,
  restoreDeletionLabel,
  restoreLastDeletion,
  selectLocale,
  setColorMode,
  toggleTurboMode,
  type GuiStoreLike,
} from "./scratch-native-menus.js";

function storeWith(state: unknown): GuiStoreLike {
  return {
    getState: () => state,
    dispatch: vi.fn(),
  };
}

describe("scratch-native-menus", () => {
  it("reads and selects locale from the Scratch locales slice", () => {
    const store = storeWith({
      locales: {
        locale: "ja",
        messagesByLocale: {ja: {}, en: {}, "ja-Hira": {}},
      },
    });
    expect(readLocale(store)).toBe("ja");
    expect(listLocales(store)).toEqual(["ja", "ja-Hira", "en"]);
    expect(localeLabel("ja-Hira")).toContain("ひらがな");
    selectLocale(store, "en");
    expect(store.dispatch).toHaveBeenCalledWith({
      type: "scratch-gui/locales/SELECT_LOCALE",
      locale: "en",
    });
  });

  it("reads and sets color mode", () => {
    const store = storeWith({
      scratchGui: {settings: {colorMode: "default"}},
    });
    expect(readColorMode(store)).toBe("default");
    setColorMode(store, COLOR_MODE_HIGH_CONTRAST);
    expect(store.dispatch).toHaveBeenCalledWith({
      type: "scratch-gui/settings/SET_COLOR_MODE",
      colorMode: COLOR_MODE_HIGH_CONTRAST,
    });
  });

  it("toggles turbo mode through the VM", () => {
    const store = storeWith({
      scratchGui: {vmStatus: {turbo: false}},
    });
    expect(readTurboMode(store)).toBe(false);
    const vm = {setTurboMode: vi.fn()};
    expect(toggleTurboMode(vm, store)).toBe(true);
    expect(vm.setTurboMode).toHaveBeenCalledWith(true);
  });

  it("restores a deleted item when Scratch exposes a restore function", () => {
    const restore = vi.fn();
    const store = storeWith({
      scratchGui: {
        restoreDeletion: {restoreFun: restore, deletedItem: "Sprite1"},
      },
    });
    expect(readRestoreDeletion(store).restorable).toBe(true);
    expect(restoreDeletionLabel("Sprite1")).toContain("スプライト");
    expect(restoreLastDeletion(store)).toBe(true);
    expect(restore).toHaveBeenCalledOnce();
    expect(store.dispatch).toHaveBeenCalledWith({
      type: "scratch-gui/restore-deletion/RESTORE_UPDATE",
      state: {restoreFun: null, deletedItem: ""},
    });
  });

  it("no-ops restore when nothing is restorable", () => {
    const store = storeWith({
      scratchGui: {restoreDeletion: {restoreFun: null, deletedItem: ""}},
    });
    expect(restoreLastDeletion(store)).toBe(false);
    expect(store.dispatch).not.toHaveBeenCalled();
  });
});
