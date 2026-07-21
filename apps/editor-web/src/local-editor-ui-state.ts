/**
 * Local-only Scratch GUI editing context that whole-project loadProject can
 * reset. Never written to ProjectDocument / Y.Doc / peer sync.
 */

export const BLOCKS_TAB_INDEX = 0;
export const COSTUMES_TAB_INDEX = 1;
export const SOUNDS_TAB_INDEX = 2;

export const ACTIVATE_TAB_TYPE = "scratch-gui/navigation/ACTIVATE_TAB";
export const UPDATE_METRICS_TYPE = "scratch-gui/workspace-metrics/UPDATE_METRICS";

export interface WorkspaceViewport {
  scrollX: number;
  scrollY: number;
  scale: number;
}

export interface LocalEditorUiState {
  activeTabIndex: number;
  /** Viewport for the editing target, keyed later by remapped runtime id. */
  viewport: WorkspaceViewport | null;
  toolboxCategoryId: string | null;
}

export interface GuiStoreLike {
  getState(): unknown;
  dispatch(action: unknown): unknown;
}

export interface ScratchGuiSlice {
  editorTab?: {activeTabIndex?: number};
  workspaceMetrics?: {
    targets?: Record<string, WorkspaceViewport | undefined>;
  };
}

function asScratchGui(state: unknown): ScratchGuiSlice | null {
  if (!state || typeof state !== "object") return null;
  const scratchGui = (state as {scratchGui?: unknown}).scratchGui;
  if (!scratchGui || typeof scratchGui !== "object") return null;
  return scratchGui as ScratchGuiSlice;
}

export function readActiveTabIndex(store: GuiStoreLike): number {
  const gui = asScratchGui(store.getState());
  const index = gui?.editorTab?.activeTabIndex;
  return typeof index === "number" ? index : BLOCKS_TAB_INDEX;
}

export function readWorkspaceViewport(
  store: GuiStoreLike,
  runtimeTargetId: string | null | undefined,
): WorkspaceViewport | null {
  if (!runtimeTargetId) return null;
  const metrics = asScratchGui(store.getState())?.workspaceMetrics?.targets
    ?.[runtimeTargetId];
  if (!metrics) return null;
  if (
    typeof metrics.scrollX !== "number" ||
    typeof metrics.scrollY !== "number" ||
    typeof metrics.scale !== "number"
  ) {
    return null;
  }
  return {
    scrollX: metrics.scrollX,
    scrollY: metrics.scrollY,
    scale: metrics.scale,
  };
}

export function activateTabAction(activeTabIndex: number): {
  type: string;
  activeTabIndex: number;
} {
  return {type: ACTIVATE_TAB_TYPE, activeTabIndex};
}

export function updateMetricsAction(
  targetID: string,
  viewport: WorkspaceViewport,
): {
  type: string;
  targetID: string;
  scrollX: number;
  scrollY: number;
  scale: number;
} {
  return {
    type: UPDATE_METRICS_TYPE,
    targetID,
    scrollX: viewport.scrollX,
    scrollY: viewport.scrollY,
    scale: viewport.scale,
  };
}

export function captureLocalEditorUiState(
  store: GuiStoreLike,
  runtimeTargetId: string | null | undefined,
  toolboxCategoryId: string | null,
): LocalEditorUiState {
  return {
    activeTabIndex: readActiveTabIndex(store),
    viewport: readWorkspaceViewport(store, runtimeTargetId),
    toolboxCategoryId,
  };
}

/**
 * Restore local-only UI after loadProject + editingTarget remap.
 * Viewport Redux must be seeded under the *new* runtime id before
 * setEditingTarget triggers workspaceUpdate, so call seedViewport first when
 * restoring selection separately.
 */
export function restoreLocalEditorUiState(
  store: GuiStoreLike,
  snapshot: LocalEditorUiState | null,
  options: {
    newRuntimeTargetId: string | null;
    restoreToolboxCategory?: (categoryId: string) => boolean;
  },
): void {
  if (!snapshot) return;
  try {
    if (
      Number.isInteger(snapshot.activeTabIndex) &&
      snapshot.activeTabIndex >= BLOCKS_TAB_INDEX &&
      snapshot.activeTabIndex <= SOUNDS_TAB_INDEX
    ) {
      store.dispatch(activateTabAction(snapshot.activeTabIndex));
    }
  } catch {
    // Best-effort: never fail remote apply for UI restore.
  }

  try {
    if (snapshot.viewport && options.newRuntimeTargetId) {
      store.dispatch(
        updateMetricsAction(options.newRuntimeTargetId, snapshot.viewport),
      );
    }
  } catch {
    // ignore
  }

  try {
    if (snapshot.toolboxCategoryId && options.restoreToolboxCategory) {
      options.restoreToolboxCategory(snapshot.toolboxCategoryId);
    }
  } catch {
    // ignore
  }
}

export function seedViewportForRuntimeTarget(
  store: GuiStoreLike,
  runtimeTargetId: string | null,
  viewport: WorkspaceViewport | null,
): void {
  if (!runtimeTargetId || !viewport) return;
  try {
    store.dispatch(updateMetricsAction(runtimeTargetId, viewport));
  } catch {
    // ignore
  }
}
