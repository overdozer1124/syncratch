/**
 * Passive instrumentation for Blockly → VM change events.
 *
 * Records Blockly workspace events and correlates post-settle visible graph
 * hashes with the same generation IDs used by workspace-update instrumentation.
 */

import {
  hashBlocklyWorkspaceEdges,
  hashVmVisibleBlockGraph,
  type BlocklyBlockLike,
  type BlocklyChangeEventLike,
  type BlocklyWorkspaceLike,
  type VmBlockLike,
} from "./workspace-desync-diagnostics.js";

export type BlockEventDropKind =
  | "move"
  | "delete"
  | "connection-change"
  | "any-move";

export type VmBlockListenerHost = {
  blockListener: (event: BlocklyEventLike) => void;
};

export type BlockEventDropDecision = {
  kind: BlockEventDropKind;
  logDrop: (entry: {
    kind: BlockEventDropKind;
    event: BlocklyEventLike;
    syncGeneration?: number;
  }) => void;
} | null;

let pipelineVm: VmBlockListenerHost | null = null;
let originalBlockListener: ((event: BlocklyEventLike) => void) | null = null;
let readDropDecision: (() => BlockEventDropDecision) | null = null;

export type BlocklyEventLike = BlocklyChangeEventLike;

export type BlocklyVmEventContext = {
  loadEpoch: number;
  suppressVmChanges: boolean;
  diagnosticReady: boolean;
  uiRestoreEpoch: number;
  collaborationGeneration: number;
  projectSessionId: number;
  saveDirtyGeneration: number;
  editingTargetId?: string;
};

export type BlocklyEventLogEntry = {
  seq: number;
  at: number;
  syncGeneration: number;
  type: string;
  blockId?: string;
  element?: string;
  name?: string;
  oldParentId?: string | null;
  newParentId?: string | null;
  oldInputName?: string | null;
  newInputName?: string | null;
  graphMutating: boolean;
  moveKind?: "move" | "connection-change" | "other";
  loadEpoch: number;
  suppressVmChanges: boolean;
  diagnosticReady: boolean;
  uiRestoreEpoch: number;
  collaborationGeneration: number;
  projectSessionId: number;
  saveDirtyGeneration: number;
  editingTargetId?: string;
  repeatCount?: number;
};

export type BlocklyVmGraphDiffEntry = {
  seq: number;
  at: number;
  afterEventSeq: number;
  syncGeneration: number;
  eventType: string;
  blockId?: string;
  blocklyEdgeHash: string;
  vmEdgeHash: string;
  blocklyTopBlocks: number | null;
  vmScriptCount: number;
  mismatch: boolean;
  loadEpoch: number;
  collaborationGeneration: number;
  projectSessionId: number;
  saveDirtyGeneration: number;
  editingTargetId?: string;
  repeatCount?: number;
};

const MAX_EVENT_ENTRIES = 100;
const MAX_DIFF_ENTRIES = 50;

const eventEntries: BlocklyEventLogEntry[] = [];
const diffEntries: BlocklyVmGraphDiffEntry[] = [];

let eventSeq = 0;
let diffSeq = 0;
let syncGeneration = 0;

export function isGraphMutatingBlocklyEvent(event: BlocklyEventLike): boolean {
  if (event.type === "create" || event.type === "delete") return true;
  if (event.type === "move") return true;
  if (event.type === "change" && event.element === "mutation") return true;
  return false;
}

export function classifyMoveEvent(
  event: BlocklyEventLike,
): "move" | "connection-change" | "other" {
  if (event.type !== "move") return "other";
  const hasConnection = Boolean(
    event.oldParentId ||
      event.newParentId ||
      event.oldInputName ||
      event.newInputName,
  );
  if (hasConnection) return "connection-change";
  if (event.newCoordinate != null) return "move";
  return "other";
}

function matchesDropKind(
  event: BlocklyEventLike,
  kind: BlockEventDropKind,
): boolean {
  if (kind === "delete") return event.type === "delete";
  if (kind === "any-move") return event.type === "move";
  if (kind === "connection-change") {
    return event.type === "move" && classifyMoveEvent(event) === "connection-change";
  }
  return event.type === "move" && classifyMoveEvent(event) === "move";
}

function diffSignature(entry: BlocklyVmGraphDiffEntry): string {
  return [
    String(entry.afterEventSeq),
    entry.eventType,
    entry.blockId ?? "",
    entry.blocklyEdgeHash,
    entry.vmEdgeHash,
    String(entry.mismatch),
  ].join("\0");
}

function pushBounded<T>(buffer: T[], item: T, max: number): void {
  buffer.push(item);
  if (buffer.length > max) buffer.shift();
}

function blocklyTopCount(workspace: BlocklyWorkspaceLike | null | undefined): number | null {
  if (!workspace?.getTopBlocks) return null;
  try {
    return (workspace.getTopBlocks(false) ?? []).filter((block: BlocklyBlockLike) => {
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

function readVmGraph(target: {
  blocks?: {
    getScripts?: () => string[];
    _blocks?: Record<string, VmBlockLike>;
  };
} | null | undefined): {
  vmScriptCount: number;
  vmEdgeHash: string;
} {
  const blocks = target?.blocks?._blocks;
  const scripts = target?.blocks?.getScripts?.();
  return {
    vmScriptCount: Array.isArray(scripts) ? scripts.length : 0,
    vmEdgeHash: hashVmVisibleBlockGraph(blocks),
  };
}

export function recordBlocklyEvent(
  event: BlocklyEventLike,
  context: BlocklyVmEventContext,
): BlocklyEventLogEntry {
  eventSeq += 1;
  syncGeneration += 1;
  const graphMutating = isGraphMutatingBlocklyEvent(event);
  const entry: BlocklyEventLogEntry = {
    seq: eventSeq,
    at: Date.now(),
    syncGeneration,
    type: event.type ?? "?",
    blockId: event.blockId,
    element: event.element,
    name: event.name,
    oldParentId: event.oldParentId,
    newParentId: event.newParentId,
    oldInputName: event.oldInputName,
    newInputName: event.newInputName,
    graphMutating,
    moveKind: event.type === "move" ? classifyMoveEvent(event) : undefined,
    loadEpoch: context.loadEpoch,
    suppressVmChanges: context.suppressVmChanges,
    diagnosticReady: context.diagnosticReady,
    uiRestoreEpoch: context.uiRestoreEpoch,
    collaborationGeneration: context.collaborationGeneration,
    projectSessionId: context.projectSessionId,
    saveDirtyGeneration: context.saveDirtyGeneration,
    editingTargetId: context.editingTargetId,
    repeatCount: 1,
  };

  pushBounded(eventEntries, entry, MAX_EVENT_ENTRIES);
  return entry;
}

export function recordBlocklyVmGraphDiff(options: {
  afterEvent: BlocklyEventLogEntry;
  context: BlocklyVmEventContext;
  workspace: BlocklyWorkspaceLike | null | undefined;
  editingTarget: {
    blocks?: {
      getScripts?: () => string[];
      _blocks?: Record<string, VmBlockLike>;
    };
  } | null | undefined;
}): BlocklyVmGraphDiffEntry | null {
  const {afterEvent, context, workspace, editingTarget} = options;
  if (!afterEvent.graphMutating) return null;
  if (context.suppressVmChanges || !context.diagnosticReady) return null;

  const blocklyEdgeHash = hashBlocklyWorkspaceEdges(workspace);
  const vmGraph = readVmGraph(editingTarget);
  const mismatch = blocklyEdgeHash !== vmGraph.vmEdgeHash;

  diffSeq += 1;
  const entry: BlocklyVmGraphDiffEntry = {
    seq: diffSeq,
    at: Date.now(),
    afterEventSeq: afterEvent.seq,
    syncGeneration: afterEvent.syncGeneration,
    eventType: afterEvent.type,
    blockId: afterEvent.blockId,
    blocklyEdgeHash,
    vmEdgeHash: vmGraph.vmEdgeHash,
    blocklyTopBlocks: blocklyTopCount(workspace),
    vmScriptCount: vmGraph.vmScriptCount,
    mismatch,
    loadEpoch: context.loadEpoch,
    collaborationGeneration: context.collaborationGeneration,
    projectSessionId: context.projectSessionId,
    saveDirtyGeneration: context.saveDirtyGeneration,
    editingTargetId: context.editingTargetId,
    repeatCount: 1,
  };

  const last = diffEntries.at(-1);
  if (last && diffSignature(last) === diffSignature(entry)) {
    last.at = entry.at;
    last.repeatCount = (last.repeatCount ?? 1) + 1;
    return last;
  }

  pushBounded(diffEntries, entry, MAX_DIFF_ENTRIES);
  return entry;
}

export function scheduleBlocklyVmGraphDiff(
  afterEvent: BlocklyEventLogEntry,
  readContext: () => BlocklyVmEventContext,
  readWorkspace: () => BlocklyWorkspaceLike | null | undefined,
  readEditingTarget: () => {
    blocks?: {
      getScripts?: () => string[];
      _blocks?: Record<string, VmBlockLike>;
    };
  } | null | undefined,
): void {
  if (!afterEvent.graphMutating) return;
  queueMicrotask(() => {
    const run = () => {
      recordBlocklyVmGraphDiff({
        afterEvent,
        context: readContext(),
        workspace: readWorkspace(),
        editingTarget: readEditingTarget(),
      });
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => {
        if (afterEvent.type === "delete") {
          requestAnimationFrame(run);
        } else {
          run();
        }
      });
    } else {
      run();
    }
  });
}

function shouldDropEvent(
  event: BlocklyEventLike,
  decision: BlockEventDropDecision,
): decision is NonNullable<BlockEventDropDecision> {
  if (!decision) return false;
  return matchesDropKind(event, decision.kind);
}

/**
 * Wrap vm.blockListener so events are recorded before VM intake (and optional E2E drop).
 * Must run before Blocks.attachVM registers the listener reference — onVmInit is early enough.
 */
export function installBlocklyVmEventPipeline(
  vm: VmBlockListenerHost,
  readContext: () => BlocklyVmEventContext,
  readWorkspace: () => BlocklyWorkspaceLike | null | undefined,
  readEditingTarget: () => {
    blocks?: {
      getScripts?: () => string[];
      _blocks?: Record<string, VmBlockLike>;
    };
  } | null | undefined,
  options?: {
    readDropDecision?: () => BlockEventDropDecision;
  },
): () => void {
  if (pipelineVm === vm && originalBlockListener) {
    readDropDecision = options?.readDropDecision ?? null;
    return () => uninstallBlocklyVmEventPipeline(vm);
  }
  if (pipelineVm && originalBlockListener) {
    uninstallBlocklyVmEventPipeline(pipelineVm);
  }

  originalBlockListener = vm.blockListener;
  pipelineVm = vm;
  readDropDecision = options?.readDropDecision ?? null;

  vm.blockListener = (event: BlocklyEventLike) => {
    const context = readContext();
    let recorded: BlocklyEventLogEntry | null = null;
    if (!context.suppressVmChanges && context.diagnosticReady) {
      recorded = recordBlocklyEvent(event, context);
    }

    const dropDecision = readDropDecision?.() ?? null;
    if (recorded && dropDecision && shouldDropEvent(event, dropDecision)) {
      dropDecision.logDrop({
        kind: dropDecision.kind,
        event: {
          type: event.type,
          blockId: event.blockId,
          element: event.element,
          name: event.name,
          oldParentId: event.oldParentId,
          newParentId: event.newParentId,
          oldInputName: event.oldInputName,
          newInputName: event.newInputName,
        },
        syncGeneration: recorded.syncGeneration,
      });
      scheduleBlocklyVmGraphDiff(
        recorded,
        readContext,
        readWorkspace,
        readEditingTarget,
      );
      return;
    }

    originalBlockListener?.call(vm, event);
    if (recorded) {
      scheduleBlocklyVmGraphDiff(
        recorded,
        readContext,
        readWorkspace,
        readEditingTarget,
      );
    }
  };

  return () => uninstallBlocklyVmEventPipeline(vm);
}

export function uninstallBlocklyVmEventPipeline(vm: VmBlockListenerHost): void {
  if (pipelineVm === vm && originalBlockListener) {
    vm.blockListener = originalBlockListener;
  }
  if (pipelineVm === vm) {
    pipelineVm = null;
    originalBlockListener = null;
    readDropDecision = null;
  }
}

export function rebindWorkspaceBlockListener(
  workspace: {
    addChangeListener?: (listener: (event: BlocklyEventLike) => void) => void;
    removeChangeListener?: (listener: (event: BlocklyEventLike) => void) => void;
  } | null | undefined,
): void {
  if (!workspace?.addChangeListener || !workspace.removeChangeListener) return;
  if (!pipelineVm || !originalBlockListener) return;
  const wrapped = pipelineVm.blockListener;
  try {
    workspace.removeChangeListener(originalBlockListener);
  } catch {
    // ignore stale listener removal
  }
  try {
    workspace.removeChangeListener(wrapped);
  } catch {
    // ignore duplicate removal
  }
  workspace.addChangeListener(wrapped);
}

export function getWrappedBlockListener(
  vm: VmBlockListenerHost,
): ((event: BlocklyEventLike) => void) | null {
  return pipelineVm === vm ? vm.blockListener : null;
}

export function isBlocklyVmEventPipelineInstalled(
  vm: VmBlockListenerHost,
): boolean {
  return pipelineVm === vm && originalBlockListener !== null;
}

export function getBlocklyEventLog(): readonly BlocklyEventLogEntry[] {
  return eventEntries;
}

export function getBlocklyVmGraphDiffLog(): readonly BlocklyVmGraphDiffEntry[] {
  return diffEntries;
}

export function clearBlocklyVmEventInstrumentation(): void {
  eventEntries.length = 0;
  diffEntries.length = 0;
  eventSeq = 0;
  diffSeq = 0;
  syncGeneration = 0;
}

export function getSyncGeneration(): number {
  return syncGeneration;
}
