import type {ProjectDocument} from "@blocksync/project-schema";
import {
  captureLocalEditorUiState,
  restoreLocalEditorUiState,
  seedViewportForRuntimeTarget,
  type GuiStoreLike,
  type LocalEditorUiState,
  type WorkspaceViewport,
} from "./local-editor-ui-state.js";

/**
 * Scratch VM loadProject regenerates runtime target ids. Collaboration applies
 * every remote update via loadProject, which also forces editingTarget to the
 * first sprite. Selection must be remapped through a stable project identity
 * (document target id / name+stage), never by reusing the pre-load runtime id.
 *
 * Local-only GUI context (active tab / Blockly viewport / toolbox category) can
 * also reset on whole-project load. When a GUI store is provided, that context
 * is captured and restored after selection remap — never synced to peers.
 */

export interface EditingSelectionRef {
  documentId: string | null;
  isStage: boolean;
  name: string;
}

export interface EditingTargetLike {
  id?: string;
  isStage?: boolean;
  getName?: () => string;
  sprite?: {name?: string};
}

export interface RuntimeTargetLike {
  id: string;
  isStage: boolean;
  getName(): string;
  isOriginal?: boolean;
}

export interface EditingTargetVm {
  editingTarget?: EditingTargetLike | null;
  setEditingTarget(targetId: string): void;
  loadProject(project: unknown): Promise<void>;
  runtime: {targets: RuntimeTargetLike[]};
}

export interface LocalUiRestoreHooks {
  store: GuiStoreLike;
  readToolboxCategoryId?: () => string | null;
  restoreToolboxCategory?: (categoryId: string) => boolean;
  /** Stable ProjectDocument target id for the pre-load editing selection. */
  rememberedViewportForSelection?: (
    selection: EditingSelectionRef | null,
  ) => WorkspaceViewport | null;
  rememberViewportForSelection?: (
    selection: EditingSelectionRef | null,
    viewport: WorkspaceViewport,
  ) => void;
  applyViewport?: (viewport: WorkspaceViewport) => void;
  /**
   * When true, capture prefers per-target memory over lagging Redux metrics
   * (e.g. after an intentional viewport write Scratch has not mirrored yet).
   */
  preferRememberedViewport?: () => boolean;
  /** Bump and return an epoch for this apply; deferred work must match it. */
  beginRestoreEpoch?: () => number;
  isRestoreEpochCurrent?: (epoch: number) => boolean;
  /** Current runtime editing target id after user actions (stale-guard). */
  currentRuntimeEditingTargetId?: () => string | null | undefined;
  /** Injectable scheduler for deterministic tests (defaults to rAF/setTimeout). */
  scheduleViewportSettle?: (work: () => void) => void;
}

function targetName(target: EditingTargetLike): string | null {
  if (typeof target.getName === "function") {
    const name = target.getName();
    if (typeof name === "string" && name.length > 0) return name;
  }
  const spriteName = target.sprite?.name;
  return typeof spriteName === "string" && spriteName.length > 0
    ? spriteName
    : null;
}

function findDocumentTarget(
  document: ProjectDocument,
  selection: EditingSelectionRef,
): ProjectDocument["targets"][number] | null {
  if (selection.documentId) {
    const byId = document.targets.find(
      target => target.id === selection.documentId,
    );
    if (byId) return byId;
  }
  const matches = document.targets.filter(
    target =>
      target.isStage === selection.isStage && target.name === selection.name,
  );
  return matches.length === 1 ? matches[0]! : null;
}

export function captureEditingSelection(
  editingTarget: EditingTargetLike | null | undefined,
  document: ProjectDocument,
): EditingSelectionRef | null {
  if (!editingTarget) return null;
  const name = targetName(editingTarget);
  if (!name) return null;
  const isStage = Boolean(editingTarget.isStage);
  const matches = document.targets.filter(
    target => target.isStage === isStage && target.name === name,
  );
  return {
    documentId: matches.length === 1 ? matches[0]!.id : null,
    isStage,
    name,
  };
}

export function resolveRuntimeEditingTargetId(
  targets: RuntimeTargetLike[],
  selection: EditingSelectionRef | null,
  document: ProjectDocument,
): string | null {
  if (!selection) return null;
  const wanted = findDocumentTarget(document, selection);
  if (!wanted) return null;

  const originals = targets.filter(target => target.isOriginal !== false);
  const pool = originals.length > 0 ? originals : targets;
  const matches = pool.filter(
    target =>
      Boolean(target.isStage) === wanted.isStage &&
      target.getName() === wanted.name,
  );
  return matches.length === 1 ? matches[0]!.id : null;
}

export function restoreEditingSelection(
  vm: Pick<EditingTargetVm, "runtime" | "setEditingTarget">,
  selection: EditingSelectionRef | null,
  document: ProjectDocument,
): string | null {
  const runtimeId = resolveRuntimeEditingTargetId(
    vm.runtime.targets,
    selection,
    document,
  );
  if (runtimeId) vm.setEditingTarget(runtimeId);
  return runtimeId;
}

function defaultScheduleViewportSettle(work: () => void): void {
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(work);
  } else {
    setTimeout(work, 0);
  }
}

/**
 * Preserve the local editing sprite (and optional local-only GUI context) across
 * a whole-project load that regenerates runtime ids.
 */
export async function loadProjectPreservingEditingTarget(
  vm: EditingTargetVm,
  project: unknown,
  options: {
    beforeDocument: ProjectDocument;
    afterDocument: ProjectDocument;
    localUi?: LocalUiRestoreHooks;
  },
): Promise<void> {
  const selection = captureEditingSelection(
    vm.editingTarget,
    options.beforeDocument,
  );
  const restoreEpoch = options.localUi?.beginRestoreEpoch?.() ?? 0;
  let uiSnapshot: LocalEditorUiState | null = null;
  if (options.localUi) {
    try {
      const remembered = options.localUi.rememberedViewportForSelection?.(
        selection,
      ) ?? null;
      uiSnapshot = captureLocalEditorUiState(
        options.localUi.store,
        vm.editingTarget?.id,
        options.localUi.readToolboxCategoryId?.() ?? null,
        remembered,
        {
          preferRemembered:
            options.localUi.preferRememberedViewport?.() ?? false,
        },
      );
      if (uiSnapshot.viewport) {
        options.localUi.rememberViewportForSelection?.(
          selection,
          uiSnapshot.viewport,
        );
      }
    } catch {
      uiSnapshot = null;
    }
  }

  await vm.loadProject(project);

  const newRuntimeId = resolveRuntimeEditingTargetId(
    vm.runtime.targets,
    selection,
    options.afterDocument,
  );

  // Seed remapped viewport metrics before setEditingTarget so Scratch's
  // workspaceUpdate restores scroll/zoom for the new runtime id.
  if (options.localUi && uiSnapshot?.viewport) {
    seedViewportForRuntimeTarget(
      options.localUi.store,
      newRuntimeId,
      uiSnapshot.viewport,
    );
  }

  if (newRuntimeId) vm.setEditingTarget(newRuntimeId);

  if (options.localUi) {
    restoreLocalEditorUiState(options.localUi.store, uiSnapshot, {
      newRuntimeTargetId: newRuntimeId,
      restoreToolboxCategory: options.localUi.restoreToolboxCategory,
      restoreTabAndToolbox: true,
    });
    // Push the captured viewport onto the live Blockly workspace immediately so
    // Scratch's translate/zoom → Redux path echoes our seed instead of the
    // previous sprite scroll. A deferred settle only repairs resize nudges.
    if (uiSnapshot?.viewport && newRuntimeId) {
      try {
        options.localUi.applyViewport?.(uiSnapshot.viewport);
      } catch {
        // Best-effort only.
      }
      const localUi = options.localUi;
      const viewport = uiSnapshot.viewport;
      const schedule =
        localUi.scheduleViewportSettle ?? defaultScheduleViewportSettle;
      schedule(() => {
        try {
          if (
            localUi.isRestoreEpochCurrent &&
            !localUi.isRestoreEpochCurrent(restoreEpoch)
          ) {
            return;
          }
          const currentId = localUi.currentRuntimeEditingTargetId?.();
          if (currentId !== undefined && currentId !== newRuntimeId) {
            return;
          }
          seedViewportForRuntimeTarget(localUi.store, newRuntimeId, viewport);
          localUi.applyViewport?.(viewport);
          localUi.rememberViewportForSelection?.(selection, viewport);
        } catch {
          // Best-effort only.
        }
      });
    }
  }
}
