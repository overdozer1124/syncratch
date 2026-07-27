/**
 * Passive instrumentation for VM → Blockly workspace reloads.
 *
 * Observes `workspaceUpdate` without wrapping emit, Blockly load, or exception
 * handling. Correlates updates with load epochs and save/collab generations.
 */

import {
  collectVmShadowBlockIds,
  hashBlocklyWorkspaceEdges,
  hashVmVisibleBlockGraph,
  type BlocklyWorkspaceLike,
} from "./workspace-desync-diagnostics.js";

export type LoadBoundaryKind = "boot" | "load" | "remote" | "guest" | "rewind";

export type WorkspaceUpdateLogEntry = {
  seq: number;
  at: number;
  phase: "start" | "settled";
  loadEpoch: number;
  loadKind?: LoadBoundaryKind;
  suppressVmChanges: boolean;
  diagnosticReady: boolean;
  uiRestoreEpoch: number;
  collaborationGeneration: number;
  projectSessionId: number;
  saveDirtyGeneration: number;
  editingTargetId?: string;
  editingTargetName?: string;
  xmlLength: number;
  vmScriptCount: number;
  vmBlockCount: number;
  vmEdgeHash: string;
  vmShadowBlockIds?: string[];
  blocklyTopBlocks?: number | null;
  blocklyEdgeHash?: string;
  /** VM scripts remain but Blockly graph does not match — partial reload likely. */
  partialFailureLikely?: boolean;
  settledAt?: number;
  durationMs?: number;
  repeatCount?: number;
};

export type LoadBoundaryLogEntry = {
  seq: number;
  at: number;
  loadEpoch: number;
  kind: LoadBoundaryKind;
  suppressed: boolean;
  collaborationGeneration: number;
  projectSessionId: number;
  saveDirtyGeneration: number;
};

export type SuppressedDirtyLogEntry = {
  at: number;
  loadEpoch: number;
  collaborationGeneration: number;
  projectSessionId: number;
  saveDirtyGeneration: number;
  repeatCount?: number;
};

export type WorkspaceUpdateInstrumentationContext = {
  loadEpoch: number;
  loadKind?: LoadBoundaryKind;
  suppressVmChanges: boolean;
  diagnosticReady: boolean;
  uiRestoreEpoch: number;
  collaborationGeneration: number;
  projectSessionId: number;
  saveDirtyGeneration: number;
  editingTarget?: {
    id?: string;
    getName?: () => string;
    blocks?: {
      getScripts?: () => string[];
      _blocks?: Record<
        string,
        {
          parent?: string | null;
          next?: string | null;
          shadow?: boolean;
          inputs?: Record<
            string,
            {block?: string | null; shadow?: string | null} | null | undefined
          >;
        }
      >;
    };
  } | null;
};

const MAX_UPDATE_ENTRIES = 50;
const MAX_BOUNDARY_ENTRIES = 30;
const MAX_SUPPRESSED_DIRTY_ENTRIES = 20;

const updateEntries: WorkspaceUpdateLogEntry[] = [];
const boundaryEntries: LoadBoundaryLogEntry[] = [];
const suppressedDirtyEntries: SuppressedDirtyLogEntry[] = [];

let workspaceUpdateSeq = 0;
let loadEpoch = 0;
let activeLoadKind: LoadBoundaryKind | undefined;
let boundarySeq = 0;

const pendingSettles = new Map<
  number,
  {startedAt: number; startEntry: WorkspaceUpdateLogEntry}
>();

function readVmGraph(
  target: WorkspaceUpdateInstrumentationContext["editingTarget"],
): {
  vmScriptCount: number;
  vmBlockCount: number;
  vmEdgeHash: string;
  vmShadowBlockIds: string[];
} {
  const raw = target?.blocks?._blocks;
  const ids = raw && typeof raw === "object" ? Object.keys(raw) : [];
  const scripts = target?.blocks?.getScripts?.();
  return {
    vmScriptCount: Array.isArray(scripts) ? scripts.length : 0,
    vmBlockCount: ids.length,
    vmEdgeHash: hashVmVisibleBlockGraph(raw),
    vmShadowBlockIds: collectVmShadowBlockIds(raw),
  };
}

function blocklyTopCount(workspace: BlocklyWorkspaceLike | null | undefined): number | null {
  if (!workspace?.getTopBlocks) return null;
  try {
    const tops = workspace.getTopBlocks(false) ?? [];
    return tops.filter(block => {
      try {
        return !block.isShadow?.();
      } catch {
        return true;
      }
    }).length;
  } catch {
    return null;
  }
}

function updateSignature(entry: WorkspaceUpdateLogEntry): string {
  return [
    entry.phase,
    String(entry.loadEpoch),
    entry.editingTargetId ?? "",
    String(entry.xmlLength),
    String(entry.vmScriptCount),
    entry.vmEdgeHash,
    String(entry.blocklyTopBlocks),
    entry.blocklyEdgeHash ?? "",
    String(entry.partialFailureLikely),
  ].join("\0");
}

function pushBounded<T>(buffer: T[], item: T, max: number): void {
  buffer.push(item);
  if (buffer.length > max) buffer.shift();
}

export function getLoadEpoch(): number {
  return loadEpoch;
}

export function getActiveLoadKind(): LoadBoundaryKind | undefined {
  return activeLoadKind;
}

export function recordLoadBoundaryTransition(
  kind: LoadBoundaryKind,
  suppressed: boolean,
  context: Omit<
    WorkspaceUpdateInstrumentationContext,
    "loadEpoch" | "loadKind"
  >,
): LoadBoundaryLogEntry {
  if (suppressed) {
    loadEpoch += 1;
    activeLoadKind = kind;
  } else {
    activeLoadKind = undefined;
  }

  boundarySeq += 1;
  const entry: LoadBoundaryLogEntry = {
    seq: boundarySeq,
    at: Date.now(),
    loadEpoch,
    kind,
    suppressed,
    collaborationGeneration: context.collaborationGeneration,
    projectSessionId: context.projectSessionId,
    saveDirtyGeneration: context.saveDirtyGeneration,
  };
  pushBounded(boundaryEntries, entry, MAX_BOUNDARY_ENTRIES);
  return entry;
}

export function recordSuppressedProjectChanged(
  context: Omit<
    WorkspaceUpdateInstrumentationContext,
    "loadEpoch" | "loadKind"
  >,
): SuppressedDirtyLogEntry {
  const last = suppressedDirtyEntries.at(-1);
  if (
    last &&
    last.loadEpoch === loadEpoch &&
    last.collaborationGeneration === context.collaborationGeneration &&
    last.projectSessionId === context.projectSessionId &&
    last.saveDirtyGeneration === context.saveDirtyGeneration
  ) {
    last.at = Date.now();
    last.repeatCount = (last.repeatCount ?? 1) + 1;
    return last;
  }

  const entry: SuppressedDirtyLogEntry = {
    at: Date.now(),
    loadEpoch,
    collaborationGeneration: context.collaborationGeneration,
    projectSessionId: context.projectSessionId,
    saveDirtyGeneration: context.saveDirtyGeneration,
    repeatCount: 1,
  };
  pushBounded(suppressedDirtyEntries, entry, MAX_SUPPRESSED_DIRTY_ENTRIES);
  return entry;
}

export function recordWorkspaceUpdateStart(
  context: WorkspaceUpdateInstrumentationContext,
  xmlLength: number,
): WorkspaceUpdateLogEntry {
  workspaceUpdateSeq += 1;
  const seq = workspaceUpdateSeq;
  const target = context.editingTarget;
  const vmGraph = readVmGraph(target);
  const entry: WorkspaceUpdateLogEntry = {
    seq,
    at: Date.now(),
    phase: "start",
    loadEpoch: context.loadEpoch,
    loadKind: context.loadKind ?? activeLoadKind,
    suppressVmChanges: context.suppressVmChanges,
    diagnosticReady: context.diagnosticReady,
    uiRestoreEpoch: context.uiRestoreEpoch,
    collaborationGeneration: context.collaborationGeneration,
    projectSessionId: context.projectSessionId,
    saveDirtyGeneration: context.saveDirtyGeneration,
    editingTargetId: target?.id,
    editingTargetName:
      typeof target?.getName === "function" ? target.getName() : undefined,
    xmlLength,
    ...vmGraph,
  };

  const last = updateEntries.at(-1);
  if (last && last.phase === "start" && updateSignature(last) === updateSignature(entry)) {
    last.at = entry.at;
    last.repeatCount = (last.repeatCount ?? 1) + 1;
    pendingSettles.set(seq, {startedAt: entry.at, startEntry: last});
    return {...last, seq};
  }

  entry.repeatCount = 1;
  pushBounded(updateEntries, entry, MAX_UPDATE_ENTRIES);
  pendingSettles.set(seq, {startedAt: entry.at, startEntry: entry});
  return entry;
}

export function recordWorkspaceUpdateSettled(
  seq: number,
  context: WorkspaceUpdateInstrumentationContext,
  workspace: BlocklyWorkspaceLike | null | undefined,
): WorkspaceUpdateLogEntry | null {
  const pending = pendingSettles.get(seq);
  pendingSettles.delete(seq);
  if (!pending) return null;

  const target = context.editingTarget;
  const vmGraph = readVmGraph(target);
  const blocklyEdgeHash = hashBlocklyWorkspaceEdges(workspace);
  const blocklyTopBlocks = blocklyTopCount(workspace);
  const partialFailureLikely =
    vmGraph.vmScriptCount > 0 &&
    (blocklyTopBlocks === 0 || blocklyEdgeHash !== vmGraph.vmEdgeHash);

  const settledAt = Date.now();
  const entry: WorkspaceUpdateLogEntry = {
    seq,
    at: pending.startedAt,
    phase: "settled",
    loadEpoch: pending.startEntry.loadEpoch,
    loadKind: pending.startEntry.loadKind,
    suppressVmChanges: context.suppressVmChanges,
    diagnosticReady: context.diagnosticReady,
    uiRestoreEpoch: context.uiRestoreEpoch,
    collaborationGeneration: context.collaborationGeneration,
    projectSessionId: context.projectSessionId,
    saveDirtyGeneration: context.saveDirtyGeneration,
    editingTargetId: target?.id,
    editingTargetName:
      typeof target?.getName === "function" ? target.getName() : undefined,
    xmlLength: pending.startEntry.xmlLength,
    ...vmGraph,
    blocklyTopBlocks,
    blocklyEdgeHash,
    partialFailureLikely,
    settledAt,
    durationMs: settledAt - pending.startedAt,
    repeatCount: 1,
  };

  const last = updateEntries.at(-1);
  if (last && updateSignature(last) === updateSignature(entry)) {
    last.at = pending.startedAt;
    last.settledAt = settledAt;
    last.durationMs = settledAt - pending.startedAt;
    last.repeatCount = (last.repeatCount ?? 1) + 1;
    return last;
  }

  pushBounded(updateEntries, entry, MAX_UPDATE_ENTRIES);
  return entry;
}

export function getWorkspaceUpdateLog(): readonly WorkspaceUpdateLogEntry[] {
  return updateEntries;
}

export function getLoadBoundaryLog(): readonly LoadBoundaryLogEntry[] {
  return boundaryEntries;
}

export function getSuppressedDirtyLog(): readonly SuppressedDirtyLogEntry[] {
  return suppressedDirtyEntries;
}

export function clearWorkspaceUpdateInstrumentation(): void {
  updateEntries.length = 0;
  boundaryEntries.length = 0;
  suppressedDirtyEntries.length = 0;
  pendingSettles.clear();
  workspaceUpdateSeq = 0;
  loadEpoch = 0;
  activeLoadKind = undefined;
  boundarySeq = 0;
}

export type WorkspaceUpdateListenerVm = {
  on(event: "workspaceUpdate", handler: (data: {xml?: string}) => void): void;
};

export function installWorkspaceUpdateListener(
  vm: WorkspaceUpdateListenerVm,
  readContext: () => WorkspaceUpdateInstrumentationContext,
  readWorkspace: () => BlocklyWorkspaceLike | null | undefined,
): void {
  vm.on("workspaceUpdate", data => {
    const start = recordWorkspaceUpdateStart(
      readContext(),
      data?.xml?.length ?? 0,
    );
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        recordWorkspaceUpdateSettled(start.seq, readContext(), readWorkspace());
      });
    });
  });
}
