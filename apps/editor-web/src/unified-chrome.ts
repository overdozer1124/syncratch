/**
 * Keep Scratch's menu items clear of the Syncratch chrome overlay by
 * publishing the left-cluster width as a CSS variable.
 */

export const SYNCRATCH_CHROME_LEFT_VAR = "--syncratch-chrome-left";

export function measureChromeLeftWidth(chromeLeft: HTMLElement): number {
  return Math.ceil(chromeLeft.getBoundingClientRect().width);
}

export function applyChromeLeftWidth(
  root: HTMLElement,
  widthPx: number,
): void {
  root.style.setProperty(SYNCRATCH_CHROME_LEFT_VAR, `${Math.max(0, widthPx)}px`);
}

export function syncSyncratchChromeLeft(options: {
  root?: HTMLElement;
  chromeLeft: HTMLElement | null;
}): number {
  const root = options.root ?? document.documentElement;
  const width = options.chromeLeft
    ? measureChromeLeftWidth(options.chromeLeft)
    : 0;
  applyChromeLeftWidth(root, width);
  return width;
}

export function installSyncratchChromeLayout(options: {
  root?: HTMLElement;
  chromeLeft: HTMLElement;
}): () => void {
  const root = options.root ?? document.documentElement;
  const sync = () => {
    syncSyncratchChromeLeft({root, chromeLeft: options.chromeLeft});
  };
  sync();
  const observer = new ResizeObserver(sync);
  observer.observe(options.chromeLeft);
  window.addEventListener("resize", sync);
  return () => {
    observer.disconnect();
    window.removeEventListener("resize", sync);
  };
}
