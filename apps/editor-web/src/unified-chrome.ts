/**
 * Keep Scratch menu items clear of the Syncratch chrome overlay by
 * publishing left-cluster and Scratch-menu widths as CSS variables.
 */

export const SYNCRATCH_CHROME_LEFT_VAR = "--syncratch-chrome-left";
export const SYNCRATCH_MENU_SLOT_VAR = "--syncratch-menu-slot";

/** Fallback when Scratch menus are not mounted yet. */
export const DEFAULT_MENU_SLOT_PX = 360;

/** Extra air between Scratch Edit and Syncratch feature panels. */
export const MENU_SLOT_GAP_PX = 20;

export function measureChromeLeftWidth(chromeLeft: HTMLElement): number {
  return Math.ceil(chromeLeft.getBoundingClientRect().width);
}

export function applyChromeLeftWidth(
  root: HTMLElement,
  widthPx: number,
): void {
  root.style.setProperty(
    SYNCRATCH_CHROME_LEFT_VAR,
    `${Math.max(0, widthPx)}px`,
  );
}

export function applyMenuSlotWidth(root: HTMLElement, widthPx: number): void {
  root.style.setProperty(
    SYNCRATCH_MENU_SLOT_VAR,
    `${Math.max(0, widthPx)}px`,
  );
}

function queryByAriaLabel(
  root: ParentNode,
  labels: readonly string[],
): HTMLElement | null {
  for (const label of labels) {
    const hit = root.querySelector<HTMLElement>(`[aria-label="${label}"]`);
    if (hit) return hit;
  }
  return null;
}

/**
 * Width of Scratch 設定 / ファイル / 編集 (first file-group), excluding a
 * hidden logo button. Used to push Syncratch feature panels to the right.
 */
export function measureScratchPrimaryMenuWidth(
  guiHost: HTMLElement | null | undefined,
): number {
  if (!guiHost) return DEFAULT_MENU_SLOT_PX;
  const banner =
    guiHost.querySelector<HTMLElement>('header[role="banner"]') ??
    guiHost.querySelector<HTMLElement>('[class*="menu-bar_menu-bar_"]');
  if (!banner) return DEFAULT_MENU_SLOT_PX;

  const settings = queryByAriaLabel(banner, ["設定メニュー", "Settings menu"]);
  const file = queryByAriaLabel(banner, ["ファイルメニュー", "File menu"]);
  const edit = queryByAriaLabel(banner, ["編集メニュー", "Edit menu"]);

  const items = [settings, file, edit].filter(
    (el): el is HTMLElement => el != null,
  );
  if (items.length === 0) {
    const fileGroup = banner.querySelector<HTMLElement>(
      '[class*="menu-bar_file-group_"]',
    );
    if (!fileGroup) return DEFAULT_MENU_SLOT_PX;
    return Math.max(
      DEFAULT_MENU_SLOT_PX,
      Math.ceil(fileGroup.getBoundingClientRect().width) + MENU_SLOT_GAP_PX,
    );
  }

  const left = Math.min(...items.map(el => el.getBoundingClientRect().left));
  const right = Math.max(...items.map(el => el.getBoundingClientRect().right));
  return Math.max(
    DEFAULT_MENU_SLOT_PX,
    Math.ceil(right - left) + MENU_SLOT_GAP_PX,
  );
}

export function syncSyncratchChromeLayout(options: {
  root?: HTMLElement;
  chromeLeft: HTMLElement | null;
  guiHost?: HTMLElement | null;
}): {chromeLeft: number; menuSlot: number} {
  const root = options.root ?? document.documentElement;
  const chromeLeft = options.chromeLeft
    ? measureChromeLeftWidth(options.chromeLeft)
    : 0;
  const menuSlot = measureScratchPrimaryMenuWidth(options.guiHost);
  applyChromeLeftWidth(root, chromeLeft);
  applyMenuSlotWidth(root, menuSlot);
  return {chromeLeft, menuSlot};
}

/** @deprecated Prefer syncSyncratchChromeLayout */
export function syncSyncratchChromeLeft(options: {
  root?: HTMLElement;
  chromeLeft: HTMLElement | null;
}): number {
  return syncSyncratchChromeLayout({
    root: options.root,
    chromeLeft: options.chromeLeft,
  }).chromeLeft;
}

export function installSyncratchChromeLayout(options: {
  root?: HTMLElement;
  chromeLeft: HTMLElement;
  guiHost: HTMLElement;
}): () => void {
  const root = options.root ?? document.documentElement;
  const sync = () => {
    syncSyncratchChromeLayout({
      root,
      chromeLeft: options.chromeLeft,
      guiHost: options.guiHost,
    });
  };
  sync();
  const resizeObserver = new ResizeObserver(sync);
  resizeObserver.observe(options.chromeLeft);
  resizeObserver.observe(options.guiHost);
  const mutationObserver = new MutationObserver(sync);
  mutationObserver.observe(options.guiHost, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "aria-label"],
  });
  window.addEventListener("resize", sync);
  return () => {
    resizeObserver.disconnect();
    mutationObserver.disconnect();
    window.removeEventListener("resize", sync);
  };
}
