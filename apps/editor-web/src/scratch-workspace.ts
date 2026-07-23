import type {WorkspaceViewport} from "./local-editor-ui-state.js";

export interface ScratchWorkspaceLike {
  scrollX?: number;
  scrollY?: number;
  scale?: number;
  resize?: () => void;
  /** Blockly: true during block or workspace drag / keyboard move. */
  isDragging?: () => boolean;
  /** Blockly: force-end the open gesture (pointer listeners). */
  cancelCurrentGesture?: () => void;
  getToolbox?: () => {
    getSelectedItem?: () => {getId?: () => string} | null;
    getToolboxItemById?: (id: string) => unknown;
    setSelectedItem?: (item: unknown) => void;
    selectCategoryByName?: (name: string) => void;
  } | null;
}

export interface ScratchBlocksApiLike {
  getMainWorkspace?: () => ScratchWorkspaceLike | null;
  Workspace?: {
    getAll?: () => ScratchWorkspaceLike[];
  };
}

function asWorkspace(value: unknown): ScratchWorkspaceLike | null {
  if (!value || typeof value !== "object") return null;
  const workspace = value as ScratchWorkspaceLike;
  if (
    typeof workspace.scrollX !== "number" ||
    typeof workspace.scrollY !== "number" ||
    typeof workspace.scale !== "number"
  ) {
    return null;
  }
  return workspace;
}

/**
 * Resolve the Scratch GUI Blockly workspace without requiring a timed fallback.
 * Prefer the live ScratchBlocks main workspace; also walk React fibers from the
 * injection host because `globalThis.Blockly` may be a Msg-only stub.
 */
export function resolveScratchWorkspace(
  root: ParentNode | null | undefined,
  blocksApi: ScratchBlocksApiLike | null | undefined = (
    globalThis as unknown as {Blockly?: ScratchBlocksApiLike}
  ).Blockly,
): ScratchWorkspaceLike | null {
  const fromMain = asWorkspace(blocksApi?.getMainWorkspace?.());
  if (fromMain) return fromMain;

  try {
    const all = blocksApi?.Workspace?.getAll?.();
    if (Array.isArray(all)) {
      for (const candidate of all) {
        const workspace = asWorkspace(candidate);
        if (workspace) return workspace;
      }
    }
  } catch {
    // ignore
  }

  if (!root || typeof root.querySelector !== "function") return null;
  const starts = [
    root.querySelector('[class*="blocks_blocks"]'),
    root.querySelector(".injectionDiv"),
    root.querySelector("svg.blocklySvg"),
  ].filter((node): node is Element => Boolean(node));

  for (const start of starts) {
    // React fiber keys are non-enumerable — Object.keys misses them.
    const fiberKey = Object.getOwnPropertyNames(start).find(
      key =>
        key.startsWith("__reactFiber$") ||
        key.startsWith("__reactInternalInstance$") ||
        key.startsWith("__reactContainer$"),
    );
    let fiber: {stateNode?: {workspace?: unknown}; return?: unknown} | null =
      fiberKey
        ? ((start as unknown as Record<string, unknown>)[fiberKey] as {
            stateNode?: {workspace?: unknown};
            return?: unknown;
          })
        : null;
    for (let depth = 0; fiber && depth < 80; depth += 1) {
      const workspace = asWorkspace(fiber.stateNode?.workspace);
      if (workspace) return workspace;
      fiber = (fiber.return as typeof fiber) ?? null;
    }
  }
  return null;
}

export function readWorkspaceViewportFromScratch(
  workspace: ScratchWorkspaceLike | null | undefined,
): WorkspaceViewport | null {
  if (!workspace) return null;
  if (
    typeof workspace.scrollX !== "number" ||
    typeof workspace.scrollY !== "number" ||
    typeof workspace.scale !== "number"
  ) {
    return null;
  }
  return {
    scrollX: workspace.scrollX,
    scrollY: workspace.scrollY,
    scale: workspace.scale,
  };
}

export function applyViewportToScratchWorkspace(
  workspace: ScratchWorkspaceLike | null | undefined,
  viewport: WorkspaceViewport,
): boolean {
  if (!workspace) return false;
  try {
    workspace.scrollX = viewport.scrollX;
    workspace.scrollY = viewport.scrollY;
    workspace.scale = viewport.scale;
    workspace.resize?.();
    return true;
  } catch {
    return false;
  }
}

function metricsNumberClose(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

/** True when a Redux metrics update is only the echo of our own seed. */
export function isInternalMetricsEcho(
  pending: {
    epoch: number;
    targetId: string;
    viewport: WorkspaceViewport;
  } | null,
  current: {
    epoch: number;
    targetId: string;
    viewport: WorkspaceViewport;
  },
): boolean {
  if (!pending) return false;
  if (pending.epoch !== current.epoch) return false;
  if (pending.targetId !== current.targetId) return false;
  return (
    metricsNumberClose(pending.viewport.scrollX, current.viewport.scrollX) &&
    metricsNumberClose(pending.viewport.scrollY, current.viewport.scrollY) &&
    metricsNumberClose(pending.viewport.scale, current.viewport.scale)
  );
}
