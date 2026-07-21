/**
 * Scratch VM loadProject always resets editingTarget to the first sprite
 * (or stage). Collaboration applies every remote change via loadProject, so
 * peers would yank the local user's selected sprite. Capture and restore it.
 */

export interface EditingTargetVm {
  editingTarget?: {id?: string} | null;
  setEditingTarget(targetId: string): void;
  loadProject(project: unknown): Promise<void>;
}

export function currentEditingTargetId(vm: EditingTargetVm): string | null {
  const id = vm.editingTarget?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

export async function loadProjectPreservingEditingTarget(
  vm: EditingTargetVm,
  project: unknown,
): Promise<void> {
  const editingTargetId = currentEditingTargetId(vm);
  await vm.loadProject(project);
  if (editingTargetId) {
    vm.setEditingTarget(editingTargetId);
  }
}
