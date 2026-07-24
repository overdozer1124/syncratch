/**
 * Bridge Scratch GUI Redux/VM features into Syncratch-owned menus
 * (設定 / ファイル / 編集), so the editor no longer relies on Scratch's
 * separate menu-bar buttons.
 */

export type GuiStoreLike = {
  getState(): unknown;
  dispatch(action: unknown): unknown;
  subscribe?(listener: () => void): () => void;
};

export type TurboVm = {
  setTurboMode(enabled: boolean): void;
};

const SELECT_LOCALE = "scratch-gui/locales/SELECT_LOCALE";
const SET_COLOR_MODE = "scratch-gui/settings/SET_COLOR_MODE";

export const COLOR_MODE_DEFAULT = "default";
export const COLOR_MODE_HIGH_CONTRAST = "high-contrast";

const LOCALE_LABELS: Record<string, string> = {
  ja: "日本語",
  "ja-Hira": "にほんご（ひらがな）",
  en: "English",
  "zh-cn": "简体中文",
  "zh-tw": "繁體中文",
  ko: "한국어",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

export function readLocale(store: GuiStoreLike): string {
  const locales = asRecord(asRecord(store.getState())?.locales);
  const locale = locales?.locale;
  return typeof locale === "string" && locale ? locale : "ja";
}

export function listLocales(store: GuiStoreLike): string[] {
  const locales = asRecord(asRecord(store.getState())?.locales);
  const byLocale = asRecord(locales?.messagesByLocale);
  if (!byLocale) return ["ja", "en"];
  return Object.keys(byLocale).sort((a, b) => {
    const rank = (code: string): number => {
      if (code === "ja") return 0;
      if (code === "ja-Hira") return 1;
      if (code === "en") return 2;
      return 10;
    };
    const diff = rank(a) - rank(b);
    return diff !== 0 ? diff : a.localeCompare(b);
  });
}

export function localeLabel(code: string): string {
  return LOCALE_LABELS[code] ?? code;
}

export function selectLocale(store: GuiStoreLike, locale: string): void {
  store.dispatch({type: SELECT_LOCALE, locale});
}

export function readColorMode(store: GuiStoreLike): string {
  const gui = asRecord(asRecord(store.getState())?.scratchGui);
  const settings = asRecord(gui?.settings);
  const mode = settings?.colorMode;
  return typeof mode === "string" && mode ? mode : COLOR_MODE_DEFAULT;
}

export function setColorMode(store: GuiStoreLike, colorMode: string): void {
  store.dispatch({type: SET_COLOR_MODE, colorMode});
  try {
    const key = "scratchtheme";
    if (
      colorMode !== COLOR_MODE_DEFAULT &&
      colorMode !== COLOR_MODE_HIGH_CONTRAST
    ) {
      return;
    }
    if (colorMode === COLOR_MODE_DEFAULT) {
      document.cookie = `${key}=;path=/`;
      return;
    }
    const expires = new Date();
    expires.setFullYear(expires.getFullYear() + 1);
    document.cookie = `${key}=${colorMode};expires=${expires.toUTCString()};path=/`;
  } catch {
    // Cookie persistence is best-effort in restricted environments.
  }
}

export function readTurboMode(store: GuiStoreLike): boolean {
  const gui = asRecord(asRecord(store.getState())?.scratchGui);
  const status = asRecord(gui?.vmStatus);
  return status?.turbo === true;
}

export function toggleTurboMode(vm: TurboVm, store: GuiStoreLike): boolean {
  const next = !readTurboMode(store);
  vm.setTurboMode(next);
  return next;
}

export type RestoreDeletionState = {
  restorable: boolean;
  deletedItem: string;
  restore: (() => void) | null;
};

export function readRestoreDeletion(store: GuiStoreLike): RestoreDeletionState {
  const gui = asRecord(asRecord(store.getState())?.scratchGui);
  const restoreDeletion = asRecord(gui?.restoreDeletion);
  const restoreFun = restoreDeletion?.restoreFun;
  const deletedItem =
    typeof restoreDeletion?.deletedItem === "string"
      ? restoreDeletion.deletedItem
      : "";
  if (typeof restoreFun === "function") {
    return {
      restorable: true,
      deletedItem,
      restore: restoreFun as () => void,
    };
  }
  return {restorable: false, deletedItem: "", restore: null};
}

export function restoreDeletionLabel(deletedItem: string): string {
  if (!deletedItem) return "けしたものを もとにもどす";
  if (/sprite|スプライト/i.test(deletedItem)) {
    return "けした スプライトを もどす";
  }
  if (/sound|おと|音/i.test(deletedItem)) {
    return "けした おとを もどす";
  }
  if (/costume|衣装|すがた/i.test(deletedItem)) {
    return "けした すがたを もどす";
  }
  return "けしたものを もとにもどす";
}

export function restoreLastDeletion(store: GuiStoreLike): boolean {
  const state = readRestoreDeletion(store);
  if (!state.restorable || !state.restore) return false;
  state.restore();
  store.dispatch({
    type: "scratch-gui/restore-deletion/RESTORE_UPDATE",
    state: {restoreFun: null, deletedItem: ""},
  });
  return true;
}
