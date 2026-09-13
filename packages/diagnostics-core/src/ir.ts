/**
 * Read-only diagnostic IR built from ProjectDocument.
 * Does not mutate the source document. Not related to BlockIRProposal.
 */

import {
  extractBlockRefsFromInput,
  isScratchBlock,
  type ProjectDocument,
  type ScratchBlock,
} from "@blocksync/project-schema";

export interface DiagnosticVariableIR {
  id: string;
  name: string;
  targetId: string;
  value: string | number;
}

export interface DiagnosticListIR {
  id: string;
  name: string;
  targetId: string;
}

export interface DiagnosticBroadcastIR {
  id: string;
  name: string;
  /** Target that declares the broadcast (usually the stage). */
  targetId: string;
}

/**
 * Normalized Scratch input with primary vs shadow distinguished.
 *
 * Scratch encodings (SB3):
 * - mode 1: `[1, blockId]` or `[1, primitiveArray]` — shadow / obscured-none
 * - mode 2: `[2, blockId | null]` — block without shadow (incl. SUBSTACK)
 * - mode 3: `[3, primaryId, shadowId|primitive]` — block obscuring a shadow
 *
 * Prefer `extractBlockRefsFromInput()` when primary/shadow distinction is not
 * required. Use this normalizer when the distinction matters (e.g. broadcast
 * menu shadows under `BROADCAST_INPUT`).
 */
export interface DiagnosticInputIR {
  mode: number | null;
  primaryBlockId: string | null;
  shadowBlockId: string | null;
  /** Inline primitive when value[1]/value[2] is an array like `[4, "10"]`. */
  inlinePrimitive: readonly unknown[] | null;
  /** True when a SUBSTACK-style slot is explicitly empty (`[2, null]`). */
  empty: boolean;
  /** Refs from `extractBlockRefsFromInput` (primary + optional shadow id). */
  blockRefs: readonly string[];
}

export interface DiagnosticFieldIR {
  name: string;
  value: string | number | boolean | null;
  id: string | null;
}

export interface DiagnosticBlockIR {
  id: string;
  targetId: string;
  opcode: string;
  parentId: string | null;
  nextId: string | null;
  topLevel: boolean;
  shadow: boolean;
  inputs: ReadonlyMap<string, DiagnosticInputIR>;
  fields: ReadonlyMap<string, DiagnosticFieldIR>;
  mutation: Readonly<Record<string, unknown>> | null;
}

export interface DiagnosticTargetIR {
  id: string;
  name: string;
  isStage: boolean;
  blocksById: ReadonlyMap<string, DiagnosticBlockIR>;
  /** Deterministic top-level non-shadow roots (id ascending). */
  scriptRootIds: readonly string[];
}

export interface DiagnosticProjectIR {
  schemaVersion: 1;
  targets: DiagnosticTargetIR[];
  variablesById: ReadonlyMap<string, DiagnosticVariableIR>;
  listsById: ReadonlyMap<string, DiagnosticListIR>;
  broadcastsById: ReadonlyMap<string, DiagnosticBroadcastIR>;
}

function isFieldPrimitive(
  value: unknown,
): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export function normalizeDiagnosticField(
  name: string,
  value: unknown,
): DiagnosticFieldIR {
  if (Array.isArray(value)) {
    const fieldValue = value[0];
    const idPart = value.length > 1 ? value[1] : null;
    return {
      name,
      value: isFieldPrimitive(fieldValue) ? fieldValue : null,
      id: typeof idPart === "string" || idPart === null ? idPart : null,
    };
  }
  if (isFieldPrimitive(value)) {
    return {name, value, id: null};
  }
  return {name, value: null, id: null};
}

/**
 * Documented input normalizer: primary vs shadow distinction.
 * @see DiagnosticInputIR
 */
export function normalizeDiagnosticInput(value: unknown): DiagnosticInputIR {
  const blockRefs = extractBlockRefsFromInput(value);
  if (!Array.isArray(value) || value.length < 1) {
    return {
      mode: null,
      primaryBlockId: null,
      shadowBlockId: null,
      inlinePrimitive: null,
      empty: false,
      blockRefs,
    };
  }

  const mode = typeof value[0] === "number" ? value[0] : null;
  let primaryBlockId: string | null = null;
  let shadowBlockId: string | null = null;
  let inlinePrimitive: readonly unknown[] | null = null;
  let empty = false;

  if (mode === 1) {
    if (typeof value[1] === "string") {
      // Mode 1 is shadow-only occupancy in SB3.
      shadowBlockId = value[1];
    } else if (Array.isArray(value[1])) {
      inlinePrimitive = Object.freeze([...value[1]]) as readonly unknown[];
    } else if (value[1] === null || value[1] === undefined) {
      empty = true;
    }
  } else if (mode === 2) {
    if (typeof value[1] === "string") {
      primaryBlockId = value[1];
    } else if (value[1] === null || value[1] === undefined) {
      empty = true;
    }
  } else if (mode === 3) {
    if (typeof value[1] === "string") {
      primaryBlockId = value[1];
    } else if (value[1] === null || value[1] === undefined) {
      empty = true;
    }
    if (typeof value[2] === "string") {
      shadowBlockId = value[2];
    } else if (Array.isArray(value[2])) {
      inlinePrimitive = Object.freeze([...value[2]]) as readonly unknown[];
    }
  } else {
    if (typeof value[1] === "string") primaryBlockId = value[1];
    if (typeof value[2] === "string") shadowBlockId = value[2];
    if (Array.isArray(value[1])) {
      inlinePrimitive = Object.freeze([...value[1]]) as readonly unknown[];
    } else if (Array.isArray(value[2])) {
      inlinePrimitive = Object.freeze([...value[2]]) as readonly unknown[];
    }
  }

  return {
    mode,
    primaryBlockId,
    shadowBlockId,
    inlinePrimitive,
    empty,
    blockRefs,
  };
}

/** Prefer primary occupant; fall back to shadow (e.g. unused menu shadow). */
export function inputOccupantBlockId(input: DiagnosticInputIR): string | null {
  return input.primaryBlockId ?? input.shadowBlockId;
}

function buildBlockIR(
  id: string,
  targetId: string,
  block: ScratchBlock,
): DiagnosticBlockIR {
  const inputEntries = Object.keys(block.inputs ?? {})
    .sort()
    .map(
      key =>
        [key, normalizeDiagnosticInput(block.inputs[key])] as [
          string,
          DiagnosticInputIR,
        ],
    );
  const fieldEntries = Object.keys(block.fields ?? {})
    .sort()
    .map(
      key =>
        [key, normalizeDiagnosticField(key, block.fields[key])] as [
          string,
          DiagnosticFieldIR,
        ],
    );

  const mutation =
    block.mutation && typeof block.mutation === "object"
      ? Object.freeze({...block.mutation})
      : null;

  return {
    id,
    targetId,
    opcode: block.opcode,
    parentId: block.parent ?? null,
    nextId: block.next ?? null,
    topLevel: block.topLevel === true || block.parent == null,
    shadow: block.shadow === true,
    inputs: new Map(inputEntries),
    fields: new Map(fieldEntries),
    mutation,
  };
}

/**
 * Cycle-safe walk of next + SUBSTACK/SUBSTACK2 occupants.
 * Used by tests and future fact extractors; IR build itself enumerates the map.
 */
export function walkDiagnosticStack(
  blocksById: ReadonlyMap<string, DiagnosticBlockIR>,
  startId: string,
  visit: (block: DiagnosticBlockIR) => void,
): void {
  const seen = new Set<string>();
  const queue: string[] = [startId];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const block = blocksById.get(id);
    if (!block) continue;
    visit(block);

    if (block.nextId && !seen.has(block.nextId)) {
      queue.push(block.nextId);
    }
    for (const slot of ["SUBSTACK", "SUBSTACK2"] as const) {
      const input = block.inputs.get(slot);
      if (!input) continue;
      const child = inputOccupantBlockId(input);
      if (child && !seen.has(child)) queue.push(child);
    }
  }
}

function scriptRootIds(
  blocksById: ReadonlyMap<string, DiagnosticBlockIR>,
): string[] {
  const roots: string[] = [];
  for (const [id, block] of blocksById) {
    if (block.shadow) continue;
    if (block.topLevel || block.parentId == null) {
      roots.push(id);
    }
  }
  return roots.sort((a, b) => a.localeCompare(b));
}

/**
 * Build a deterministic, read-only diagnostic IR from a ProjectDocument.
 * Every object ScratchBlock appears once. Cyclic next/input graphs do not hang.
 */
export function buildDiagnosticProjectIR(
  document: ProjectDocument,
): DiagnosticProjectIR {
  const variablesById = new Map<string, DiagnosticVariableIR>();
  const listsById = new Map<string, DiagnosticListIR>();
  const broadcastsById = new Map<string, DiagnosticBroadcastIR>();
  const targets: DiagnosticTargetIR[] = [];

  for (const target of document.targets) {
    const targetId = target.id;

    for (const [id, entry] of Object.entries(target.variables ?? {})) {
      if (variablesById.has(id)) continue;
      variablesById.set(id, {
        id,
        name: String(entry[0]),
        targetId,
        value: entry[1],
      });
    }
    for (const [id, entry] of Object.entries(target.lists ?? {})) {
      if (listsById.has(id)) continue;
      listsById.set(id, {
        id,
        name: String(entry[0]),
        targetId,
      });
    }
    for (const [id, name] of Object.entries(target.broadcasts ?? {})) {
      if (broadcastsById.has(id)) continue;
      broadcastsById.set(id, {
        id,
        name: String(name),
        targetId,
      });
    }

    const blockEntries: Array<[string, DiagnosticBlockIR]> = [];
    for (const id of Object.keys(target.blocks).sort()) {
      const entry = target.blocks[id];
      if (!entry || !isScratchBlock(entry)) continue;
      blockEntries.push([id, buildBlockIR(id, targetId, entry)]);
    }
    const blocksById = new Map(blockEntries);

    targets.push({
      id: targetId,
      name: target.name,
      isStage: target.isStage,
      blocksById,
      scriptRootIds: scriptRootIds(blocksById),
    });
  }

  return {
    schemaVersion: 1,
    targets,
    variablesById,
    listsById,
    broadcastsById,
  };
}
