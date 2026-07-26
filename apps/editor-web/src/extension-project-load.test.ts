import {beforeEach, describe, expect, it, vi} from "vitest";
import {
  installProjectExtensionLoader,
  resolveProjectExtensionModuleUrl,
} from "./extension-project-load.js";

vi.mock("./extension-gallery.js", async () => {
  const actual = await vi.importActual<typeof import("./extension-gallery.js")>(
    "./extension-gallery.js",
  );
  return {
    ...actual,
    loadExtensionModuleUrl: vi.fn(async () => "fetch"),
  };
});

import {loadExtensionModuleUrl} from "./extension-gallery.js";

beforeEach(() => {
  vi.mocked(loadExtensionModuleUrl).mockClear();
});

describe("resolveProjectExtensionModuleUrl", () => {
  it("maps catalog TurboWarp ids to their module URL", () => {
    expect(resolveProjectExtensionModuleUrl("fetch")).toEqual({
      moduleUrl: "https://extensions.turbowarp.org/fetch.js",
      expectedId: "fetch",
    });
  });

  it("leaves builtin ids to the stock loader", () => {
    expect(resolveProjectExtensionModuleUrl("music")).toBeNull();
    expect(resolveProjectExtensionModuleUrl("pen")).toBeNull();
  });

  it("treats absolute and relative URLs as module loads", () => {
    expect(
      resolveProjectExtensionModuleUrl(
        "https://extensions.turbowarp.org/files.js",
      ),
    ).toEqual({
      moduleUrl: "https://extensions.turbowarp.org/files.js",
    });
    expect(resolveProjectExtensionModuleUrl("extensions/qrcode.mjs")).toEqual({
      moduleUrl: "extensions/qrcode.mjs",
    });
  });
});

describe("installProjectExtensionLoader", () => {
  it("routes catalog custom ids through loadExtensionModuleUrl", async () => {
    const original = vi.fn(async () => undefined);
    const loaded = new Map<string, string>();
    const vm = {
      runtime: {},
      extensionManager: {
        isExtensionLoaded: (id: string) => loaded.has(id),
        loadExtensionURL: original,
        _loadedExtensions: loaded,
        _registerInternalExtension: vi.fn(),
      },
    };

    installProjectExtensionLoader(vm);
    await vm.extensionManager.loadExtensionURL("fetch");

    expect(loadExtensionModuleUrl).toHaveBeenCalledWith(
      vm,
      "https://extensions.turbowarp.org/fetch.js",
      "fetch",
    );
    expect(original).not.toHaveBeenCalled();
  });

  it("keeps builtin ids on the stock path", async () => {
    const original = vi.fn(async () => undefined);
    const vm = {
      runtime: {},
      extensionManager: {
        isExtensionLoaded: () => false,
        loadExtensionURL: original,
        _loadedExtensions: new Map(),
        _registerInternalExtension: vi.fn(),
      },
    };

    installProjectExtensionLoader(vm);
    // Re-bind after patch: call through the patched function.
    const patched = vm.extensionManager.loadExtensionURL;
    // Restore original reference onto a fresh manager shape for the test of
    // "builtin uses original" — the patch closed over `original`.
    await patched("music");
    expect(original).toHaveBeenCalledWith("music");
    expect(loadExtensionModuleUrl).not.toHaveBeenCalled();
  });

  it("soft-fails unknown custom ids instead of rejecting", async () => {
    const original = vi.fn(async () => {
      throw new Error("worker failed");
    });
    const onSkipped = vi.fn();
    const vm = {
      runtime: {},
      extensionManager: {
        isExtensionLoaded: () => false,
        loadExtensionURL: original,
        _loadedExtensions: new Map(),
        _registerInternalExtension: vi.fn(),
      },
    };

    installProjectExtensionLoader(vm, {onSkipped});
    await expect(
      vm.extensionManager.loadExtensionURL("totally-unknown-ext"),
    ).resolves.toBeUndefined();
    expect(onSkipped).toHaveBeenCalledWith(
      "totally-unknown-ext",
      expect.any(Error),
    );
  });

  it("is idempotent", () => {
    const original = vi.fn(async () => undefined);
    const vm = {
      runtime: {},
      extensionManager: {
        isExtensionLoaded: () => false,
        loadExtensionURL: original,
        _loadedExtensions: new Map(),
        _registerInternalExtension: vi.fn(),
      },
    };
    installProjectExtensionLoader(vm);
    const first = vm.extensionManager.loadExtensionURL;
    installProjectExtensionLoader(vm);
    expect(vm.extensionManager.loadExtensionURL).toBe(first);
  });
});
