/**
 * Ring buffer of Blockly/VM desync snapshots for post-mortem diagnosis.
 * Stores IDs, opcodes, and connection hashes — not block field values or assets.
 */

export type BlockEdgeRecord = {
  parent?: string | null;
  next?: string | null;
  inputs?: Record<
    string,
    {block?: string | null; shadow?: string | null} | null | undefined
  >;
};

export type VmBlockLike = {
  parent?: string | null;
  next?: string | null;
  shadow?: boolean;
  inputs?: Record<
    string,
    {block?: string | null; shadow?: string | null} | null | undefined
  >;
};

export type WorkspaceVmDesyncEntry = {
  seq: number;
  at: number;
  /** How many consecutive polls produced the same signature. */
  repeatCount?: number;
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

export type BlocklyBlockLike = {
  id?: string;
  isShadow?: () => boolean;
  getParent?: () => BlocklyBlockLike | null;
  getNextBlock?: () => BlocklyBlockLike | null;
  inputList?: Array<{
    name?: string;
    connection?: {targetBlock?: () => BlocklyBlockLike | null};
  }>;
};

export type BlocklyChangeEventLike = {
  type?: string;
  blockId?: string;
  element?: string;
  name?: string;
  oldParentId?: string | null;
  newParentId?: string | null;
  oldInputName?: string | null;
  newInputName?: string | null;
  newCoordinate?: unknown;
  recordUndo?: boolean;
};

export type BlocklyWorkspaceLike = {
  getAllBlocks?: (ordered?: boolean) => BlocklyBlockLike[];
  getTopBlocks?: (ordered?: boolean) => BlocklyBlockLike[];
  addChangeListener?: (listener: (event: BlocklyChangeEventLike) => void) => void;
  removeChangeListener?: (listener: (event: BlocklyChangeEventLike) => void) => void;
};

const MAX_ENTRIES = 50;
const entries: WorkspaceVmDesyncEntry[] = [];
let seq = 0;

function normalizeInputEdges(
  inputs: BlockEdgeRecord["inputs"],
): string {
  if (!inputs) return "";
  return Object.keys(inputs)
    .sort()
    .map(name => {
      const input = inputs[name];
      if (!input) return `${name}::`;
      return `${name}:${input.block ?? ""}:${input.shadow ?? ""}`;
    })
    .join(",");
}

/** Visible graph inputs: real block connections only (no shadow-only slots). */
function normalizeVisibleInputEdges(
  inputs: BlockEdgeRecord["inputs"],
): string {
  if (!inputs) return "";
  return Object.keys(inputs)
    .sort()
    .map(name => {
      const input = inputs[name];
      if (!input?.block) return "";
      return `${name}:${input.block}`;
    })
    .filter(Boolean)
    .join(",");
}

export function collectVmShadowBlockIds(
  blocks: Record<string, VmBlockLike> | undefined,
): string[] {
  if (!blocks) return [];
  return Object.keys(blocks)
    .filter(id => blocks[id]?.shadow === true)
    .sort();
}

export function vmBlocksToVisibleEdgeRecords(
  blocks: Record<string, VmBlockLike> | undefined,
): {blocks: Record<string, BlockEdgeRecord>; ids: string[]} {
  if (!blocks) return {blocks: {}, ids: []};
  const shadowIds = new Set(collectVmShadowBlockIds(blocks));
  const ids = Object.keys(blocks).filter(id => !shadowIds.has(id));
  const normalized: Record<string, BlockEdgeRecord> = {};
  for (const id of ids) {
    const block = blocks[id];
    if (!block) continue;
    const parent =
      block.parent && !shadowIds.has(block.parent) ? block.parent : null;
    const next = block.next && !shadowIds.has(block.next) ? block.next : null;
    const inputs: BlockEdgeRecord["inputs"] = {};
    for (const [name, input] of Object.entries(block.inputs ?? {})) {
      if (!input?.block || shadowIds.has(input.block)) continue;
      inputs[name] = {block: input.block, shadow: null};
    }
    normalized[id] = {parent, next, inputs};
  }
  return {blocks: normalized, ids};
}

/**
 * Stable hash of block parent/next/input edges for quick graph comparison.
 */
export function hashBlockGraphEdges(
  blocks: Record<string, BlockEdgeRecord> | undefined,
  ids: string[],
): string {
  if (!blocks || ids.length === 0) return "0";
  const parts = ids
    .slice()
    .sort()
    .map(id => {
      const block = blocks[id];
      if (!block) return `${id}:?`;
      return `${id}:${block.parent ?? ""}:${block.next ?? ""}:${normalizeInputEdges(block.inputs)}`;
    });
  return parts.join("|");
}

/** Hash non-shadow visible connections (matches Blockly workspace graph). */
export function hashVisibleBlockGraphEdges(
  blocks: Record<string, BlockEdgeRecord> | undefined,
  ids: string[],
): string {
  if (!blocks || ids.length === 0) return "0";
  const parts = ids
    .slice()
    .sort()
    .map(id => {
      const block = blocks[id];
      if (!block) return `${id}:?`;
      return `${id}:${block.parent ?? ""}:${block.next ?? ""}:${normalizeVisibleInputEdges(block.inputs)}`;
    });
  return parts.join("|");
}

export function hashVmVisibleBlockGraph(
  blocks: Record<string, VmBlockLike> | undefined,
): string {
  const {blocks: normalized, ids} = vmBlocksToVisibleEdgeRecords(blocks);
  return hashVisibleBlockGraphEdges(normalized, ids);
}

/** @deprecated Use hashBlockGraphEdges — kept for existing imports/tests. */
export const hashBlockEdges = hashBlockGraphEdges;

function blocklyBlocksToEdgeRecords(
  workspace: BlocklyWorkspaceLike,
): {blocks: Record<string, BlockEdgeRecord>; ids: string[]} {
  const all = workspace.getAllBlocks?.(false) ?? [];
  const blocks: Record<string, BlockEdgeRecord> = {};
  const ids: string[] = [];
  for (const block of all) {
    if (!block?.id) continue;
    try {
      if (block.isShadow?.()) continue;
    } catch {
      // treat as a real block
    }
    ids.push(block.id);
    const inputs: BlockEdgeRecord["inputs"] = {};
    for (const input of block.inputList ?? []) {
      if (!input.name) continue;
      const target = input.connection?.targetBlock?.();
      if (target) {
        try {
          if (target.isShadow?.()) continue;
        } catch {
          // treat as a real block
        }
      }
      if (!target?.id) continue;
      inputs[input.name] = {
        block: target.id,
        shadow: null,
      };
    }
    blocks[block.id] = {
      parent: block.getParent?.()?.id ?? null,
      next: block.getNextBlock?.()?.id ?? null,
      inputs,
    };
  }
  return {blocks, ids};
}

/** Hash Blockly workspace connection graph (parent, next, input targets). */
export function hashBlocklyWorkspaceEdges(
  workspace: BlocklyWorkspaceLike | null | undefined,
): string {
  if (!workspace?.getAllBlocks) return "0";
  try {
    const {blocks, ids} = blocklyBlocksToEdgeRecords(workspace);
    return hashVisibleBlockGraphEdges(blocks, ids);
  } catch {
    return "?";
  }
}

function entrySignature(
  entry: Omit<WorkspaceVmDesyncEntry, "seq" | "at" | "repeatCount">,
): string {
  const threadSig = entry.threads
    .map(
      thread =>
        `${thread.targetId ?? ""}:${thread.topBlock ?? ""}:${thread.peekStack ?? ""}:${thread.isKilled ?? ""}:${thread.status ?? ""}`,
    )
    .join(",");
  return [
    entry.editingTargetId ?? "",
    String(entry.workspaceTopBlocks),
    String(entry.vmScriptCount),
    entry.vmEdgeHash,
    entry.blocklyEdgeHash,
    entry.action,
    threadSig,
  ].join("\0");
}

export function recordWorkspaceVmDesync(
  partial: Omit<WorkspaceVmDesyncEntry, "seq" | "at" | "repeatCount">,
): WorkspaceVmDesyncEntry {
  const signature = entrySignature(partial);
  const last = entries.at(-1);
  if (last && entrySignature(last) === signature) {
    last.at = Date.now();
    last.repeatCount = (last.repeatCount ?? 1) + 1;
    return last;
  }

  seq += 1;
  const entry: WorkspaceVmDesyncEntry = {
    seq,
    at: Date.now(),
    repeatCount: 1,
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
  seq = 0;
}
