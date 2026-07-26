/**
 * Route project-restore extension loads through Syncratch's gallery loader.
 *
 * Stock Scratch VM `loadExtensionURL` only knows builtin ids; anything else
 * spawns `extension-worker.js`. TurboWarp / Xcratch gallery extensions are
 * unsandboxed classic scripts or ESM modules — the worker path rejects, and
 * `installTargets` / `loadProject` fails. That surfaces as the boot splash
 * 「エディターを始められませんでした」 after a user added a custom extension
 * and reloaded (IndexedDB still has the opcodes).
 */

import {findDefaultExtension} from "@blocksync/project-schema";
import {
  loadExtensionModuleUrl,
  type ExtensionVm,
} from "./extension-gallery.js";

const PATCHED_FLAG = "_syncratchProjectExtensionLoader";

export type ProjectExtensionLoadVm = ExtensionVm & {
  extensionManager: ExtensionVm["extensionManager"] & {
    [PATCHED_FLAG]?: boolean;
  };
};

function looksLikeExtensionUrl(value: string): boolean {
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(value) ||
    value.startsWith("//") ||
    value.startsWith("/") ||
    value.includes("/") ||
    /\.(m?js)(\?|#|$)/i.test(value)
  );
}

/**
 * Resolve a project extension id or URL to a module URL Syncratch can load.
 * Returns null when the stock builtin worker/id path should be used instead.
 */
export function resolveProjectExtensionModuleUrl(
  extensionIdOrUrl: string,
): {moduleUrl: string; expectedId?: string} | null {
  if (!extensionIdOrUrl) return null;

  if (looksLikeExtensionUrl(extensionIdOrUrl)) {
    return {moduleUrl: extensionIdOrUrl};
  }

  const entry = findDefaultExtension(extensionIdOrUrl);
  if (!entry) return null;
  if (entry.kind === "builtin" || entry.kind === "loader") return null;
  if (!entry.extensionURL) return null;
  return {
    moduleUrl: entry.extensionURL,
    expectedId: entry.extensionId ?? undefined,
  };
}

/**
 * Patch `vm.extensionManager.loadExtensionURL` so project restore can reload
 * gallery extensions. Failures for custom extensions are swallowed so a single
 * broken extension cannot brick editor boot.
 */
export function installProjectExtensionLoader(
  vm: ProjectExtensionLoadVm,
  options?: {
    onSkipped?: (extensionIdOrUrl: string, error: unknown) => void;
  },
): void {
  const manager = vm.extensionManager;
  if (manager[PATCHED_FLAG]) return;

  const original = manager.loadExtensionURL.bind(manager);
  manager.loadExtensionURL = async (extensionURL: string) => {
    if (manager.isExtensionLoaded(extensionURL)) {
      return original(extensionURL);
    }

    const resolved = resolveProjectExtensionModuleUrl(extensionURL);
    if (!resolved) {
      try {
        return await original(extensionURL);
      } catch (error) {
        // Unknown custom id with no catalog URL: do not fail the whole project.
        options?.onSkipped?.(extensionURL, error);
        return;
      }
    }

    try {
      await loadExtensionModuleUrl(
        vm,
        resolved.moduleUrl,
        resolved.expectedId,
      );
    } catch (error) {
      options?.onSkipped?.(extensionURL, error);
    }
  };

  manager[PATCHED_FLAG] = true;
}
