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

/** True when any target already has blocks whose opcode belongs to extensionId. */
export function extensionHasWorkspaceBlocks(
  vm: ToolboxVm,
  extensionId: string,
): boolean {
  if (!extensionId) return false;
  const prefix = `${extensionId}_`;
  const targets = (
    vm.runtime as {targets?: Array<{blocks?: {getAllBlocks?: () => unknown}}>} | null | undefined
  )?.targets;
  const candidates: unknown[] = [];
  if (Array.isArray(targets)) {
    for (const target of targets) {
      const all = target?.blocks?.getAllBlocks?.();
      if (all && typeof all === "object") candidates.push(all);
    }
  }
  const editingBlocks = (
    vm.editingTarget as {blocks?: {getAllBlocks?: () => unknown}} | undefined
  )?.blocks?.getAllBlocks?.();
  if (editingBlocks && typeof editingBlocks === "object") {
    candidates.push(editingBlocks);
  }
  for (const bag of candidates) {
    const blocks = Array.isArray(bag)
      ? bag
      : Object.values(bag as Record<string, unknown>);
    for (const block of blocks) {
      const opcode =
        block && typeof block === "object"
          ? (block as {opcode?: unknown}).opcode
          : undefined;
      if (typeof opcode === "string" && opcode.startsWith(prefix)) {
        return true;
      }
    }
  }
  return false;
}

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

/** Blockly extensions that stock Scratch/scratch-blocks actually register. */
const KNOWN_BLOCKLY_EXTENSIONS = new Set([
  "scratch_extension",
  "shape_hat",
  "monitor_block",
  "from_extension",
  "default_extension_colors",
]);

type CategoryColors = {
  color1?: string;
  color2?: string;
  color3?: string;
};

const DEFAULT_EXTENSION_COLOR = "#0FBD8C";

/**
 * Fill missing category colours in-place before stock GUI handleExtensionAdded
 * runs. Animated Text only provides color1; undefined color2/3 poison the
 * Blockly theme and blank every flyout category.
 */
export function ensureCategoryColors<T extends CategoryColors>(
  categoryInfo: T,
): T & Required<CategoryColors> {
  const color1 =
    (typeof categoryInfo.color1 === "string" && categoryInfo.color1) ||
    DEFAULT_EXTENSION_COLOR;
  const color2 =
    (typeof categoryInfo.color2 === "string" && categoryInfo.color2) || color1;
  const color3 =
    (typeof categoryInfo.color3 === "string" && categoryInfo.color3) || color2;
  categoryInfo.color1 = color1;
  categoryInfo.color2 = color2;
  categoryInfo.color3 = color3;
  return categoryInfo as T & Required<CategoryColors>;
}

/**
 * Prepare block JSON for stock ScratchBlocks:
 * - drop TurboWarp-only Blockly extensions such as `colours_looks`
 * - never keep both `style` and `colour*` (Blockly throws and blocks become
 *   0×0 husks that cannot be dragged onto the workspace)
 * - when there is no `style`, add legacy colour fields as a fallback
 */
export function prepareExtensionBlockJson(
  json: Record<string, unknown>,
  colors: CategoryColors = {},
): Record<string, unknown> {
  const next: Record<string, unknown> = {...json};
  if (Array.isArray(next.extensions)) {
    next.extensions = next.extensions.filter(
      entry => typeof entry === "string" && KNOWN_BLOCKLY_EXTENSIONS.has(entry),
    );
  }
  // Stock VM emits `style: extensionId`. Theme colours come from
  // ensureExtensionBlockStyles — colour fields here would make initSvg throw
  // "Must not have both a colour and a style".
  if (typeof next.style === "string" && next.style.length > 0) {
    delete next.colour;
    delete next.colourSecondary;
    delete next.colourTertiary;
    return next;
  }
  const filled = ensureCategoryColors({...colors});
  const colourPrimary =
    (typeof next.colour === "string" && next.colour) || filled.color1;
  const colourSecondary =
    (typeof next.colourSecondary === "string" && next.colourSecondary) ||
    filled.color2;
  const colourTertiary =
    (typeof next.colourTertiary === "string" && next.colourTertiary) ||
    filled.color3;
  next.colour = colourPrimary;
  next.colourSecondary = colourSecondary;
  next.colourTertiary = colourTertiary;
  return next;
}

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

function collectBlockJson(
  categoryInfo: ToolboxCategoryInfo & CategoryColors,
): Record<string, unknown>[] {
  const colors: CategoryColors = {
    color1: categoryInfo.color1,
    color2: categoryInfo.color2,
    color3: categoryInfo.color3,
  };
  const out: Record<string, unknown>[] = [];
  const push = (entry: {json?: Record<string, unknown>} | undefined) => {
    if (entry?.json && typeof entry.json === "object") {
      out.push(prepareExtensionBlockJson(entry.json, colors));
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
  categoryInfo: ToolboxCategoryInfo & CategoryColors,
): boolean {
  if (!scratchBlocks || typeof scratchBlocks.defineBlocksWithJsonArray !== "function") {
    return false;
  }
  const json = collectBlockJson(categoryInfo);
  if (json.length === 0) return false;
  try {
    scratchBlocks.defineBlocksWithJsonArray(json);
    return true;
  } catch {
    // Re-defining existing types can warn/throw; try one-by-one.
    let defined = 0;
    for (const block of json) {
      try {
        scratchBlocks.defineBlocksWithJsonArray([block]);
        defined += 1;
      } catch {
        // skip broken entry
      }
    }
    return defined > 0;
  }
}

/** Best-effort theme styles so block colours resolve when GUI path skipped them. */
export function ensureExtensionBlockStyles(
  scratchBlocks: ScratchBlocksLike | null | undefined,
  categoryInfo: ToolboxCategoryInfo & CategoryColors,
): boolean {
  try {
    const workspace = scratchBlocks?.getMainWorkspace?.();
    const theme = workspace?.getTheme?.();
    if (!theme || typeof theme.setBlockStyle !== "function") return false;
    const {color1: colourPrimary, color2: colourSecondary, color3: colourTertiary} =
      ensureCategoryColors(categoryInfo);
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
    return true;
  } catch {
    return false;
  }
}

export type EnsureExtensionToolboxOptions = {
  vm: ToolboxVm & {emitWorkspaceUpdate?: () => void};
  store: ToolboxStore;
  extensionId: string;
  scratchBlocks?: ScratchBlocksLike | null;
  /** Lazy resolver when the first ScratchBlocks reference is a stub. */
  resolveScratchBlocks?: () => ScratchBlocksLike | null;
  /** Select a toolbox category. Used only when selectCategoryOnSuccess is set. */
  selectCategory?: (extensionId: string) => boolean;
  /**
   * When true, select the new extension category after it appears.
   * Default false: selecting a fresh extension scrolls the continuous flyout
   * to a section that often has zero visible blocks yet.
   */
  selectCategoryOnSuccess?: boolean;
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

function resolveBlocksApi(
  scratchBlocks: ScratchBlocksLike | null | undefined,
  resolveScratchBlocks?: () => ScratchBlocksLike | null,
): ScratchBlocksLike | null {
  if (scratchBlocks && typeof scratchBlocks.defineBlocksWithJsonArray === "function") {
    return scratchBlocks;
  }
  const resolved = resolveScratchBlocks?.() ?? null;
  if (resolved && typeof resolved.defineBlocksWithJsonArray === "function") {
    return resolved;
  }
  return scratchBlocks ?? resolved;
}

/**
 * Make sure `extensionId` is present in the live toolbox and its ScratchBlocks
 * definitions can render (not icon-only) on the workspace.
 *
 * Important: do not call `workspace.updateToolbox` from here, and do not force
 * `selectCategory` to the new extension. Direct toolbox updates race the stock
 * continuous flyout rerender, and selecting a brand-new category scrolls the
 * shared flyout to an empty/broken section — which looks like "all blocks
 * disappeared".
 */
export async function ensureExtensionInToolbox(
  options: EnsureExtensionToolboxOptions,
): Promise<boolean> {
  const {
    vm,
    store,
    extensionId,
    selectCategory,
    attempts = 8,
    delayMs = 40,
    sleep = defaultSleep,
  } = options;

  if (!extensionId) return false;
  let definedBlocks = false;
  let emitted = false;

  for (let i = 0; i < attempts; i++) {
    const categoryInfo = findExtensionCategory(vm, extensionId) as
      | (ToolboxCategoryInfo & CategoryColors)
      | null;
    if (!categoryInfo) {
      await sleep(delayMs);
      continue;
    }

    // Must run before EXTENSION_ADDED: stock GUI copies color2/color3 into the
    // Blockly theme verbatim (undefined → Invalid colour → empty flyout).
    ensureCategoryColors(categoryInfo);

    const scratchBlocks = resolveBlocksApi(
      options.scratchBlocks,
      options.resolveScratchBlocks,
    );

    // Styles first: stock GUI defines blocks with `style: extensionId`, and
    // missing theme styles can render workspace blocks as icon-only husks.
    ensureExtensionBlockStyles(scratchBlocks, categoryInfo);

    // Prefer a single stock GUI pass; it rebuilds toolbox XML via makeToolboxXML.
    if (!emitted) {
      try {
        vm.emit?.("EXTENSION_ADDED", categoryInfo);
      } catch {
        // Listener errors are why we need the fallback below.
      }
      emitted = true;
      // Blocks.requestToolboxUpdate uses setTimeout(0); give it a turn.
      await sleep(Math.max(delayMs, 16));
    }

    // Re-apply styles after GUI handler (it may have thrown mid-theme update).
    ensureExtensionBlockStyles(scratchBlocks, categoryInfo);
    if (defineExtensionBlocks(scratchBlocks, categoryInfo)) {
      definedBlocks = true;
    }

    let toolboxXML = readToolboxXml(store.getState()) ?? "";
    if (toolboxHasCategory(toolboxXML, extensionId)) {
      if (definedBlocks && extensionHasWorkspaceBlocks(vm, extensionId)) {
        try {
          vm.emitWorkspaceUpdate?.();
        } catch {
          // ignore
        }
      }
      // Optional: only restore a previously selected category (local UI memory).
      // Never jump to the newly added extension — that empties the visible flyout.
      if (selectCategory && options.selectCategoryOnSuccess) {
        selectCategory(extensionId);
      }
      return true;
    }

    // Fallback: inject into the existing Redux toolbox XML only. Let Scratch GUI
    // apply it through componentDidUpdate → requestToolboxUpdate. Do not call
    // workspace.updateToolbox here (races / wrong ScratchBlocks stub).
    const categoryXml = getExtensionCategoryXml(vm, extensionId);
    if (categoryXml && toolboxXML.includes("<category")) {
      const nextXml = injectCategoryIntoToolboxXml(toolboxXML, categoryXml);
      if (nextXml !== toolboxXML) {
        store.dispatch({
          type: UPDATE_TOOLBOX_TYPE,
          toolboxXML: nextXml,
        });
        await sleep(Math.max(delayMs, 16));
      }
    }

    toolboxXML = readToolboxXml(store.getState()) ?? toolboxXML;
    if (toolboxHasCategory(toolboxXML, extensionId)) {
      if (definedBlocks && extensionHasWorkspaceBlocks(vm, extensionId)) {
        try {
          vm.emitWorkspaceUpdate?.();
        } catch {
          // ignore
        }
      }
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
