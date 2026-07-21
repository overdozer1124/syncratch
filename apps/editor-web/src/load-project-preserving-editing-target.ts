import type {ProjectDocument} from "@blocksync/project-schema";

/**
 * Scratch VM loadProject regenerates runtime target ids. Collaboration applies
 * every remote update via loadProject, which also forces editingTarget to the
 * first sprite. Selection must be remapped through a stable project identity
 * (document target id / name+stage), never by reusing the pre-load runtime id.
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
): void {
  const runtimeId = resolveRuntimeEditingTargetId(
    vm.runtime.targets,
    selection,
    document,
  );
  if (runtimeId) vm.setEditingTarget(runtimeId);
}

/**
 * Preserve the local editing sprite across a whole-project load that regenerates
 * runtime ids. Prefer passing the post-load ProjectDocument so renames that keep
 * the same collaboration id still resolve.
 */
export async function loadProjectPreservingEditingTarget(
  vm: EditingTargetVm,
  project: unknown,
  options: {
    beforeDocument: ProjectDocument;
    afterDocument: ProjectDocument;
  },
): Promise<void> {
  const selection = captureEditingSelection(
    vm.editingTarget,
    options.beforeDocument,
  );
  await vm.loadProject(project);
  restoreEditingSelection(vm, selection, options.afterDocument);
}
