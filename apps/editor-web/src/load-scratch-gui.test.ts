import {describe, expect, it, vi} from "vitest";
import {
  loadScratchGui,
  scratchGuiScriptUrl,
  setGuiLoadingVisible,
} from "./load-scratch-gui.js";

describe("scratchGuiScriptUrl", () => {
  it("roots the standalone bundle at the static base", () => {
    expect(scratchGuiScriptUrl("/")).toBe(
      "/generated/gui/scratch-gui-standalone.js",
    );
    expect(scratchGuiScriptUrl("/repo/")).toBe(
      "/repo/generated/gui/scratch-gui-standalone.js",
    );
  });
});

describe("loadScratchGui", () => {
  it("injects an async script and resolves when GUI is present", async () => {
    const root = globalThis as typeof globalThis & {GUI?: unknown};
    delete root.GUI;

    const script = {
      src: "",
      async: false,
      dataset: {} as DOMStringMap,
      onload: null as (() => void) | null,
      onerror: null as (() => void) | null,
    };
    const head = {
      appendChild: vi.fn((node: typeof script) => {
        expect(node.src).toContain("generated/gui/scratch-gui-standalone.js");
        expect(node.async).toBe(true);
        queueMicrotask(() => {
          root.GUI = {ok: true};
          node.onload?.();
        });
        return node;
      }),
    };
    const documentRef = {
      createElement: vi.fn(() => script),
      head,
    } as unknown as Document;

    await loadScratchGui(documentRef);
    expect(head.appendChild).toHaveBeenCalledTimes(1);
    expect(root.GUI).toEqual({ok: true});
    delete root.GUI;
  });
});

describe("setGuiLoadingVisible", () => {
  it("toggles the loading class and aria-busy", () => {
    const host = {
      classList: {
        toggle: vi.fn(),
      },
      setAttribute: vi.fn(),
    } as unknown as HTMLElement;
    setGuiLoadingVisible(host, true);
    expect(host.classList.toggle).toHaveBeenCalledWith("gui-loading", true);
    expect(host.setAttribute).toHaveBeenCalledWith("aria-busy", "true");
  });
});
