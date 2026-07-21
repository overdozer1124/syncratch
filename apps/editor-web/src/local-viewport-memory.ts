import type {WorkspaceViewport} from "./local-editor-ui-state.js";

/**
 * Local-only Blockly viewport memory keyed by local project + stable target
 * identity. Never synced to ProjectDocument / Y.Doc / peers.
 */
export function viewportMemoryKey(
  localProjectId: string,
  documentTargetId: string,
): string {
  return `${localProjectId}\u0000${documentTargetId}`;
}

export function createLocalViewportMemory() {
  const entries = new Map<string, WorkspaceViewport>();

  return {
    get(
      localProjectId: string,
      documentTargetId: string | null | undefined,
    ): WorkspaceViewport | null {
      if (!documentTargetId) return null;
      return entries.get(viewportMemoryKey(localProjectId, documentTargetId))
        ?? null;
    },
    set(
      localProjectId: string,
      documentTargetId: string | null | undefined,
      viewport: WorkspaceViewport,
    ): void {
      if (!documentTargetId) return;
      entries.set(
        viewportMemoryKey(localProjectId, documentTargetId),
        {...viewport},
      );
    },
    clearProject(localProjectId: string): void {
      const prefix = `${localProjectId}\u0000`;
      for (const key of [...entries.keys()]) {
        if (key.startsWith(prefix)) entries.delete(key);
      }
    },
    clearAll(): void {
      entries.clear();
    },
    size(): number {
      return entries.size;
    },
  };
}

export type LocalViewportMemory = ReturnType<typeof createLocalViewportMemory>;
