import type {ProjectDocument} from "@blocksync/project-schema";
import {
  captureLocalEditorUiState,
  isDefaultWorkspaceViewport,
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
  rememberedViewport?: () => WorkspaceViewport | null;
  rememberViewport?: (viewport: WorkspaceViewport | null) => void;
  applyViewport?: (viewport: WorkspaceViewport) => void;
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
  let uiSnapshot: LocalEditorUiState | null = null;
  if (options.localUi) {
    try {
      uiSnapshot = captureLocalEditorUiState(
        options.localUi.store,
        vm.editingTarget?.id,
        options.localUi.readToolboxCategoryId?.() ?? null,
        options.localUi.rememberedViewport?.() ?? null,
      );
      if (
        uiSnapshot.viewport &&
        !isDefaultWorkspaceViewport(uiSnapshot.viewport)
      ) {
        options.localUi.rememberViewport?.(uiSnapshot.viewport);
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
    });
    // Scratch workspaceUpdate/resize can nudge scroll after the first restore.
    // Re-apply once the current frame settles so the captured viewport sticks.
    if (uiSnapshot?.viewport && newRuntimeId) {
      await new Promise<void>(resolve => {
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(() => resolve());
        } else {
          setTimeout(resolve, 0);
        }
      });
      seedViewportForRuntimeTarget(
        options.localUi.store,
        newRuntimeId,
        uiSnapshot.viewport,
      );
      options.localUi.applyViewport?.(uiSnapshot.viewport);
      options.localUi.rememberViewport?.(uiSnapshot.viewport);
      restoreLocalEditorUiState(options.localUi.store, uiSnapshot, {
        newRuntimeTargetId: newRuntimeId,
        restoreToolboxCategory: options.localUi.restoreToolboxCategory,
      });
    }
  }
}
