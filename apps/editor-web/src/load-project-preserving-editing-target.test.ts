import {describe, expect, it, vi} from "vitest";
import {
  currentEditingTargetId,
  loadProjectPreservingEditingTarget,
} from "./load-project-preserving-editing-target.js";

describe("loadProjectPreservingEditingTarget", () => {
  it("restores the previous editing target after loadProject", async () => {
    const setEditingTarget = vi.fn();
    const vm = {
      editingTarget: {id: "sprite-b"},
      setEditingTarget,
      loadProject: vi.fn(async () => {
        // Mimic Scratch installTargets(wholeProject=true): jump to first sprite.
        vm.editingTarget = {id: "sprite-a"};
      }),
    };

    await loadProjectPreservingEditingTarget(vm, {targets: []});

    expect(vm.loadProject).toHaveBeenCalledOnce();
    expect(setEditingTarget).toHaveBeenCalledWith("sprite-b");
  });

  it("does not call setEditingTarget when nothing was selected", async () => {
    const setEditingTarget = vi.fn();
    const vm: {
      editingTarget: {id: string} | null;
      setEditingTarget: ReturnType<typeof vi.fn>;
      loadProject: ReturnType<typeof vi.fn>;
    } = {
      editingTarget: null,
      setEditingTarget,
      loadProject: vi.fn(async () => {
        vm.editingTarget = {id: "sprite-a"};
      }),
    };

    await loadProjectPreservingEditingTarget(vm, {targets: []});

    expect(setEditingTarget).not.toHaveBeenCalled();
    expect(currentEditingTargetId(vm)).toBe("sprite-a");
  });
});
