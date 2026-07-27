/**
 * Ring buffer of Blockly/VM desync snapshots for post-mortem diagnosis.
 * Stores IDs, opcodes, and connection hashes — not block field values or assets.
 */

export type WorkspaceVmDesyncEntry = {
  seq: number;
  at: number;
  editingTargetId?: string;
  editingTargetName?: string;
  workspaceTopBlocks: number | null;
  vmScriptCount: number;
  vmBlockIds: string[];
  vmEdgeHash: string;
  blocklyTopBlockIds: string[];
  blocklyEdgeHash: string;
  threads: Array<{
    targetId?: string;
    topBlock?: string | null;
    peekStack?: string | null;
    isKilled?: boolean;
    status?: number;
  }>;
  action: "detected" | "stopped";
};

const MAX_ENTRIES = 50;
const entries: WorkspaceVmDesyncEntry[] = [];
let seq = 0;

/** Stable hash of block id + parent/next for quick graph comparison. */
export function hashBlockEdges(
  blocks: Record<string, {parent?: string | null; next?: string | null}> | undefined,
  ids: string[],
): string {
  if (!blocks || ids.length === 0) return "0";
  const parts = ids
    .slice()
    .sort()
    .map(id => {
      const b = blocks[id];
      if (!b) return `${id}:?`;
      return `${id}:${b.parent ?? ""}:${b.next ?? ""}`;
    });
  return parts.join("|");
}

export function recordWorkspaceVmDesync(
  partial: Omit<WorkspaceVmDesyncEntry, "seq" | "at">,
): WorkspaceVmDesyncEntry {
  seq += 1;
  const entry: WorkspaceVmDesyncEntry = {
    seq,
    at: Date.now(),
    ...partial,
  };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  return entry;
}

export function getWorkspaceVmDesyncLog(): readonly WorkspaceVmDesyncEntry[] {
  return entries;
}

export function clearWorkspaceVmDesyncLog(): void {
  entries.length = 0;
}
