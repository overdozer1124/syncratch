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

describe("extension gallery catalog wiring", () => {
  it("includes Stretch3 and Xcratch defaults in the gallery list", () => {
    const items = buildExtensionGalleryItems();
    const keys = new Set(items.map(item => item.key));
    expect(keys.has("music")).toBe(true);
    expect(keys.has("wedo2")).toBe(true);
    expect(keys.has("ml2scratch")).toBe(true);
    expect(keys.has("g2s")).toBe(true);
    expect(keys.has("gai")).toBe(true);
    expect(keys.has("extensionLoader")).toBe(true);
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

  it("resolves relative extension URLs against the public path", () => {
    expect(resolveExtensionModuleUrl("https://example.com/a.mjs")).toBe(
      "https://example.com/a.mjs",
    );
    expect(resolveExtensionModuleUrl("extensions/iftttWebhooks.mjs")).toBe(
      "/extensions/iftttWebhooks.mjs",
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

  it("registers Xcratch-style modules via internal extension API", async () => {
    class FakeBlocks {
      constructor(public runtime: unknown) {}
      getInfo() {
        return {id: "ml2scratch", name: "ML2Scratch", blocks: []};
      }
    }
    const register = vi.fn(() => "extension_1_ml2scratch");
    const loaded = new Map<string, string>();
    const vm = {
      extensionManager: {
        isExtensionLoaded: (id: string) => loaded.has(id),
        loadExtensionURL: vi.fn(async () => undefined),
        _loadedExtensions: loaded,
        _registerInternalExtension: register,
      },
      runtime: {tag: "runtime"},
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
      expect(register).toHaveBeenCalledOnce();
      expect(loaded.get("ml2scratch")).toBe("extension_1_ml2scratch");
    } finally {
      setExtensionModuleImporterForTests(null);
    }
  });
});
