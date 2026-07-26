import {describe, expect, it, vi} from "vitest";
import {
  buildExtensionGalleryItems,
  closeExtensionLibraryAction,
  isExtensionLibraryOpen,
  loadExtensionModuleUrl,
  loadGalleryExtension,
  loadModeForEntry,
  resolveExtensionModuleUrl,
  setExtensionModuleImporterForTests,
  type ExtensionVm,
} from "./extension-gallery.js";
import type {DefaultExtensionEntry} from "@blocksync/project-schema";
import {
  resetTurbowarpLoadQueueForTests,
  setTurbowarpScriptFetcherForTests,
} from "./turbowarp-scratch.js";

describe("extension gallery catalog wiring", () => {
  it("includes Stretch3 and Xcratch defaults in the gallery list", () => {
    const items = buildExtensionGalleryItems();
    const keys = new Set(items.map(item => item.key));
    expect(keys.has("music")).toBe(true);
    expect(keys.has("wedo2")).toBe(true);
    expect(keys.has("ml2scratch")).toBe(true);
    expect(keys.has("g2s")).toBe(true);
    expect(keys.has("gai")).toBe(true);
    expect(keys.has("keyEvents")).toBe(true);
    expect(keys.has("poweredup")).toBe(true);
    expect(keys.has("fetch")).toBe(true);
    expect(keys.has("griffpatch")).toBe(true);
    expect(keys.has("Gamepad")).toBe(true);
    expect(keys.has("betterpen")).toBe(true);
    expect(keys.has("extensionLoader")).toBe(true);
  });

  it("loads Xcratch A-group and TurboWarp B-group as modules", () => {
    const items = buildExtensionGalleryItems();
    for (const id of [
      "keyEvents",
      "httpRequest",
      "xcxMPHand",
      "xcxml",
      "poweredup",
      "fetch",
      "files",
      "skyhigh173JSON",
      "localstorage",
      "stretch",
      "text",
      "cloudlink",
    ]) {
      const item = items.find(entry => entry.extensionId === id);
      expect(item, id).toBeDefined();
      expect(item!.loadMode).toBe("module");
      expect(item!.extensionURL).toBeTruthy();
    }
  });

  it("loads formerly unavailable Stretch3 ids as local modules", () => {
    const items = buildExtensionGalleryItems();
    for (const id of [
      "iftttWebhooks",
      "tm2scratch",
      "tmpose2scratch",
      "scratch2maqueen",
      "facemesh2scratch",
      "handpose2scratch",
      "pasorich",
      "qrcode",
      "ic2scratch",
      "numberbank",
    ]) {
      const item = items.find(entry => entry.extensionId === id);
      expect(item, id).toBeDefined();
      expect(item!.loadMode).toBe("module");
      expect(item!.extensionURL).toBe(`extensions/${id}.mjs`);
    }
  });

  it("includes gallery icons for stock and Stretch3 extensions", () => {
    const items = buildExtensionGalleryItems();
    for (const id of ["music", "pen", "ml2scratch", "iftttWebhooks", "g2s"]) {
      const item = items.find(entry => entry.extensionId === id);
      expect(item?.iconURL, id).toMatch(new RegExp(`extensions/icons/${id}\\.`));
      expect(item?.insetIconURL, id).toMatch(
        new RegExp(`extensions/icons/${id}-small\\.`),
      );
    }
  });

  it("resolves relative extension URLs against the public path", () => {
    expect(resolveExtensionModuleUrl("https://example.com/a.mjs")).toBe(
      "https://example.com/a.mjs",
    );
    expect(resolveExtensionModuleUrl("extensions/iftttWebhooks.mjs")).toMatch(
      /\/extensions\/iftttWebhooks\.mjs$/,
    );
  });

  it("classifies stock Scratch ids as builtin and URL modules as module", () => {
    const music: DefaultExtensionEntry = {
      extensionId: "music",
      name: "Music",
      description: "",
      collaborator: null,
      extensionURL: null,
      sources: ["scratch-foundation"],
      kind: "builtin",
      opcodePolicy: "pinned",
    };
    const ml: DefaultExtensionEntry = {
      extensionId: "ml2scratch",
      name: "ML2Scratch",
      description: "",
      collaborator: "champierre",
      extensionURL: "https://example.com/ml2scratch.mjs",
      sources: ["stretch3"],
      kind: "external",
      opcodePolicy: "prefix",
    };
    expect(loadModeForEntry(music)).toBe("builtin");
    expect(loadModeForEntry(ml)).toBe("module");
  });

  it("detects Scratch extension library modal open state", () => {
    expect(
      isExtensionLibraryOpen({
        scratchGui: {modals: {extensionLibrary: true}},
      }),
    ).toBe(true);
    expect(
      isExtensionLibraryOpen({
        scratchGui: {modals: {extensionLibrary: false}},
      }),
    ).toBe(false);
    expect(closeExtensionLibraryAction()).toEqual({
      type: "scratch-gui/modals/CLOSE_MODAL",
      modal: "extensionLibrary",
    });
  });
});

describe("TurboWarp info normalization", () => {
  it("maps LABEL blocks to separators and drops XML entries", async () => {
    const {normalizeTurbowarpExtensionInfo} = await import(
      "./extension-gallery.js"
    );
    const normalized = normalizeTurbowarpExtensionInfo({
      id: "demo",
      blocks: [
        {blockType: "label", text: "Section"},
        {
          opcode: "a",
          blockType: "command",
          text: "do A",
          extensions: ["colours_looks"],
        },
        {blockType: "xml", xml: "<label text='x'></label>"},
        "---",
      ],
    });
    expect(normalized.blocks).toEqual([
      "---",
      {opcode: "a", blockType: "command", text: "do A"},
      "---",
    ]);
  });

  it("fills color2/color3 when only color1 is provided (Animated Text)", async () => {
    const {
      normalizeTurbowarpExtensionInfo,
      deriveExtensionCompanionColor,
    } = await import("./extension-gallery.js");
    const normalized = normalizeTurbowarpExtensionInfo({
      id: "text",
      color1: "#9966FF",
      blocks: [],
    });
    expect(normalized.color1).toBe("#9966FF");
    expect(normalized.color2).toBe(deriveExtensionCompanionColor("#9966FF", 0.78));
    expect(normalized.color3).toBe(
      deriveExtensionCompanionColor(normalized.color2!, 0.78),
    );
  });
});

describe("extension gallery loading", () => {
  it("loads builtin extensions through loadExtensionURL(id)", async () => {
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

    const item = buildExtensionGalleryItems().find(
      entry => entry.extensionId === "music",
    )!;
    const result = await loadGalleryExtension(vm, item);
    expect(result).toEqual({extensionId: "music", alreadyLoaded: false});
    expect(loadExtensionURL).toHaveBeenCalledWith("music");
  });

  it("registers TurboWarp classic scripts via Scratch.extensions.register", async () => {
    resetTurbowarpLoadQueueForTests();
    setTurbowarpScriptFetcherForTests(async () => {
      return `(function (Scratch) {
  class Fetch {
    getInfo() { return { id: "fetch", name: "Fetch", blocks: [] }; }
  }
  Scratch.extensions.register(new Fetch());
})(Scratch);`;
    });
    const blockInfo: Array<{id: string; blocks: unknown[]}> = [];
    const register = vi.fn((instance: {getInfo(): {id: string}}) => {
      blockInfo.push({id: instance.getInfo().id, blocks: []});
      return "extension_1_fetch";
    });
    const loaded = new Map<string, string>();
    const vm = {
      extensionManager: {
        isExtensionLoaded: (id: string) => loaded.has(id),
        loadExtensionURL: vi.fn(async () => undefined),
        _loadedExtensions: loaded,
        _registerInternalExtension: register,
      },
      runtime: {_blockInfo: blockInfo},
    } satisfies ExtensionVm;

    try {
      const id = await loadExtensionModuleUrl(
        vm,
        "https://extensions.turbowarp.org/fetch.js",
        "fetch",
      );
      expect(id).toBe("fetch");
      expect(register).toHaveBeenCalledOnce();
      expect(loaded.get("fetch")).toBe("extension_1_fetch");
    } finally {
      setTurbowarpScriptFetcherForTests(null);
      resetTurbowarpLoadQueueForTests();
      delete (globalThis as {Scratch?: unknown}).Scratch;
    }
  });

  it("registers Xcratch-style modules via internal extension API", async () => {
    class FakeBlocks {
      constructor(public runtime: {formatMessage?: {setup?: () => unknown}}) {
        // Mimic AkaDako / GAI: replace local stub from runtime.formatMessage.
        if (runtime.formatMessage) {
          runtime.formatMessage.setup?.();
        }
      }
      getInfo() {
        return {id: "ml2scratch", name: "ML2Scratch", blocks: []};
      }
    }
    const blockInfo: Array<{id: string; blocks: unknown[]}> = [];
    const register = vi.fn((instance: {getInfo(): {id: string}}) => {
      blockInfo.push({id: instance.getInfo().id, blocks: []});
      return "extension_1_ml2scratch";
    });
    const loaded = new Map<string, string>();
    const runtime: {
      tag: string;
      formatMessage?: {setup?: () => unknown};
      _blockInfo: Array<{id: string; blocks: unknown[]}>;
    } = {
      tag: "runtime",
      _blockInfo: blockInfo,
    };
    const vm = {
      extensionManager: {
        isExtensionLoaded: (id: string) => loaded.has(id),
        loadExtensionURL: vi.fn(async () => undefined),
        _loadedExtensions: loaded,
        _registerInternalExtension: register,
      },
      runtime,
    } satisfies ExtensionVm;

    setExtensionModuleImporterForTests(async () => ({
      blockClass: FakeBlocks,
    }));
    try {
      const id = await loadExtensionModuleUrl(
        vm,
        "https://example.com/ml2scratch.mjs",
        "ml2scratch",
      );
      expect(id).toBe("ml2scratch");
      expect(typeof runtime.formatMessage?.setup).toBe("function");
      expect(register).toHaveBeenCalledOnce();
      expect(loaded.get("ml2scratch")).toBe("extension_1_ml2scratch");
    } finally {
      setExtensionModuleImporterForTests(null);
    }
  });
});
