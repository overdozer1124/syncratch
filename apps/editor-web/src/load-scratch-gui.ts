import {staticAssetUrl} from "./static-url.js";

type GuiGlobal = typeof globalThis & {GUI?: unknown};

export function scratchGuiScriptUrl(base = import.meta.env.BASE_URL): string {
  return staticAssetUrl("generated/gui/scratch-gui-standalone.js", base);
}

let loading: Promise<void> | null = null;

/** Load the Scratch standalone GUI once; safe to call from boot repeatedly. */
export function loadScratchGui(
  documentRef: Document = document,
  options: {scriptUrl?: string} = {},
): Promise<void> {
  const root = globalThis as GuiGlobal;
  if (root.GUI) {
    return Promise.resolve();
  }
  if (loading) return loading;

  loading = new Promise<void>((resolve, reject) => {
    if (root.GUI) {
      resolve();
      return;
    }
    const script = documentRef.createElement("script");
    script.src = options.scriptUrl ?? scratchGuiScriptUrl();
    script.async = true;
    script.dataset.blocksyncGui = "standalone";
    script.onload = () => {
      if (!root.GUI) {
        reject(new Error("Scratch GUI loaded without exposing window.GUI"));
        return;
      }
      resolve();
    };
    script.onerror = () => {
      loading = null;
      reject(new Error("Failed to load Scratch GUI"));
    };
    documentRef.head.appendChild(script);
  });

  return loading;
}

export function setGuiLoadingVisible(
  host: HTMLElement,
  visible: boolean,
): void {
  host.classList.toggle("gui-loading", visible);
  host.setAttribute("aria-busy", visible ? "true" : "false");
}

export {setGuiSplashProgress, setGuiSplashVisible} from "./gui-splash.js";
export type {GuiSplashProgress} from "./gui-splash.js";
