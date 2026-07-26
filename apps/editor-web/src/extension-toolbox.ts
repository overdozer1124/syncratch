/**
 * Ensure a newly registered Scratch extension appears in the Blockly toolbox.
 *
 * Stock Scratch GUI's handleExtensionAdded defines blocks, then updates block
 * theme styles, then refreshes toolbox XML. If theme setup throws, the toolbox
 * never updates — even though the VM already has the category in `_blockInfo`
 * and the gallery toast already reported success. Syncratch repairs that gap.
 */

export const UPDATE_TOOLBOX_TYPE = "scratch-gui/toolbox/UPDATE_TOOLBOX";

export type ToolboxCategoryInfo = {
  id: string;
  blocks?: Array<{
    info?: {opcode?: string; isDynamic?: boolean};
    json?: Record<string, unknown>;
    xml?: string;
  }>;
  menus?: Array<{json?: Record<string, unknown>}>;
  customFieldTypes?: Record<
    string,
    {scratchBlocksDefinition?: {json?: Record<string, unknown>}}
  >;
};

export type ToolboxRuntime = {
  _blockInfo?: ToolboxCategoryInfo[];
  getBlocksXML?: (target?: unknown) => Array<{id: string; xml: string}>;
  getTargetForStage?: () => unknown;
};

export type ToolboxVm = {
  runtime?: ToolboxRuntime | null;
  editingTarget?: unknown;
  emit?: (event: string, payload?: unknown) => void;
};

export type ToolboxStore = {
  getState: () => unknown;
  dispatch: (action: unknown) => unknown;
};

export type ScratchBlocksLike = {
  defineBlocksWithJsonArray?: (blocks: Record<string, unknown>[]) => void;
  getMainWorkspace?: () => {
    updateToolbox?: (xml: string) => void;
    getTheme?: () => {
      setBlockStyle?: (id: string, style: Record<string, unknown>) => unknown;
    } | null;
    setTheme?: (theme: unknown) => void;
  } | null;
};

/** Read current toolbox XML from Scratch GUI Redux. */
export function readToolboxXml(storeState: unknown): string | null {
  if (!storeState || typeof storeState !== "object") return null;
  const gui = (storeState as {scratchGui?: {toolbox?: {toolboxXML?: unknown}}})
    .scratchGui;
  const xml = gui?.toolbox?.toolboxXML;
  return typeof xml === "string" ? xml : null;
}

export function toolboxHasCategory(toolboxXML: string, extensionId: string): boolean {
  if (!toolboxXML || !extensionId) return false;
  return (
    toolboxXML.includes(`toolboxitemid="${extensionId}"`) ||
    toolboxXML.includes(`toolboxitemid='${extensionId}'`)
  );
}

/** Insert an extension `<category>` before the closing `</xml>`. */
export function injectCategoryIntoToolboxXml(
  toolboxXML: string,
  categoryXml: string,
): string {
  const trimmedCategory = categoryXml.trim();
  if (!trimmedCategory) return toolboxXML;
  if (!toolboxXML) {
    return `<xml style="display: none">\n${trimmedCategory}\n</xml>`;
  }
  if (toolboxXML.includes(trimmedCategory)) return toolboxXML;

  const close = toolboxXML.lastIndexOf("</xml>");
  if (close === -1) {
    return `${toolboxXML}\n<sep gap="36"/>\n${trimmedCategory}`;
  }
  const before = toolboxXML.slice(0, close).replace(/\s*$/, "");
  const after = toolboxXML.slice(close);
  return `${before}\n<sep gap="36"/>\n${trimmedCategory}\n${after}`;
}

export function findExtensionCategory(
  vm: ToolboxVm,
  extensionId: string,
): ToolboxCategoryInfo | null {
  const list = vm.runtime?._blockInfo;
  if (!Array.isArray(list)) return null;
  return list.find(entry => entry?.id === extensionId) ?? null;
}

export function getExtensionCategoryXml(
  vm: ToolboxVm,
  extensionId: string,
): string | null {
  const runtime = vm.runtime;
  if (!runtime || typeof runtime.getBlocksXML !== "function") return null;
  const target = vm.editingTarget ?? runtime.getTargetForStage?.();
  try {
    const categories = runtime.getBlocksXML(target) ?? [];
    return categories.find(entry => entry.id === extensionId)?.xml ?? null;
  } catch {
    return null;
  }
}

function collectBlockJson(categoryInfo: ToolboxCategoryInfo): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const push = (entry: {json?: Record<string, unknown>} | undefined) => {
    if (entry?.json && typeof entry.json === "object") {
      out.push(entry.json);
    }
  };

  const custom = categoryInfo.customFieldTypes;
  if (custom) {
    for (const field of Object.values(custom)) {
      push(field.scratchBlocksDefinition);
    }
  }
  for (const menu of categoryInfo.menus ?? []) {
    push(menu);
  }
  for (const block of categoryInfo.blocks ?? []) {
    if (block.info?.isDynamic) continue;
    push(block);
  }
  return out;
}

/** Best-effort: define extension block types on the live ScratchBlocks namespace. */
export function defineExtensionBlocks(
  scratchBlocks: ScratchBlocksLike | null | undefined,
  categoryInfo: ToolboxCategoryInfo,
): void {
  if (!scratchBlocks || typeof scratchBlocks.defineBlocksWithJsonArray !== "function") {
    return;
  }
  const json = collectBlockJson(categoryInfo);
  if (json.length === 0) return;
  try {
    scratchBlocks.defineBlocksWithJsonArray(json);
  } catch {
    // Re-defining existing types can warn/throw; toolbox XML injection still helps.
  }
}

/** Best-effort theme styles so block colours resolve when GUI path skipped them. */
export function ensureExtensionBlockStyles(
  scratchBlocks: ScratchBlocksLike | null | undefined,
  categoryInfo: ToolboxCategoryInfo & {
    color1?: string;
    color2?: string;
    color3?: string;
  },
): void {
  try {
    const workspace = scratchBlocks?.getMainWorkspace?.();
    const theme = workspace?.getTheme?.();
    if (!theme || typeof theme.setBlockStyle !== "function") return;
    const colourPrimary = categoryInfo.color1 ?? "#0FBD8C";
    const colourSecondary = categoryInfo.color2 ?? "#0DA57A";
    const colourTertiary = categoryInfo.color3 ?? "#0B8E69";
    theme.setBlockStyle(categoryInfo.id, {
      colourPrimary,
      colourSecondary,
      colourTertiary,
      colourQuaternary: colourTertiary,
    });
    theme.setBlockStyle(`${categoryInfo.id}_selected`, {
      colourPrimary: colourTertiary,
      colourSecondary: colourTertiary,
      colourTertiary,
      colourQuaternary: colourTertiary,
    });
    workspace?.setTheme?.(theme);
  } catch {
    // Theme is cosmetic relative to showing the category.
  }
}

export type EnsureExtensionToolboxOptions = {
  vm: ToolboxVm;
  store: ToolboxStore;
  extensionId: string;
  scratchBlocks?: ScratchBlocksLike | null;
  /** Select the category in the toolbox after it appears. */
  selectCategory?: (extensionId: string) => boolean;
  /** How many times to retry GUI event + XML injection. */
  attempts?: number;
  delayMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) =>
  new Promise<void>(resolve => {
    setTimeout(resolve, ms);
  });

/**
 * Make sure `extensionId` is present in the live toolbox.
 * Returns true when the category is in Redux toolbox XML (or was already there).
 */
export async function ensureExtensionInToolbox(
  options: EnsureExtensionToolboxOptions,
): Promise<boolean> {
  const {
    vm,
    store,
    extensionId,
    scratchBlocks = null,
    selectCategory,
    attempts = 8,
    delayMs = 40,
    sleep = defaultSleep,
  } = options;

  if (!extensionId) return false;

  for (let i = 0; i < attempts; i++) {
    const categoryInfo = findExtensionCategory(vm, extensionId);
    if (!categoryInfo) {
      await sleep(delayMs);
      continue;
    }

    // Give the stock GUI listener another chance (defines blocks + toolbox).
    try {
      vm.emit?.("EXTENSION_ADDED", categoryInfo);
    } catch {
      // Listener errors are why we need the fallback below.
    }

    defineExtensionBlocks(scratchBlocks, categoryInfo);
    ensureExtensionBlockStyles(
      scratchBlocks,
      categoryInfo as ToolboxCategoryInfo & {
        color1?: string;
        color2?: string;
        color3?: string;
      },
    );

    let toolboxXML = readToolboxXml(store.getState()) ?? "";
    if (!toolboxHasCategory(toolboxXML, extensionId)) {
      const categoryXml = getExtensionCategoryXml(vm, extensionId);
      if (categoryXml) {
        toolboxXML = injectCategoryIntoToolboxXml(toolboxXML, categoryXml);
        store.dispatch({
          type: UPDATE_TOOLBOX_TYPE,
          toolboxXML,
        });
        try {
          scratchBlocks?.getMainWorkspace?.()?.updateToolbox?.(toolboxXML);
        } catch {
          // Redux update is enough for Blocks.componentDidUpdate.
        }
      }
    }

    toolboxXML = readToolboxXml(store.getState()) ?? toolboxXML;
    if (toolboxHasCategory(toolboxXML, extensionId)) {
      selectCategory?.(extensionId);
      return true;
    }

    await sleep(delayMs);
  }

  return toolboxHasCategory(readToolboxXml(store.getState()) ?? "", extensionId);
}

/** Throw if the VM never received extension primitives (false "added" toast). */
export function assertExtensionPrimitivesRegistered(
  vm: ToolboxVm,
  extensionId: string,
): void {
  if (!findExtensionCategory(vm, extensionId)) {
    throw new Error(
      `拡張機能「${extensionId}」のブロック定義を VM に登録できませんでした`,
    );
  }
}
