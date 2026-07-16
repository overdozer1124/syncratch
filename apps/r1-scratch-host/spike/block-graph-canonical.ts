import type { ScratchBlockSpikeV0 } from "./schema/document-spike-v0.js";

/** Thrown when block graphs are invalid (missing ref, cycle). */
export class EquivalenceGraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EquivalenceGraphError";
  }
}

function sortKeysDeep(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  const obj = value as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeysDeep(obj[key]);
  }
  return sorted;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function canonicalFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(fields).sort()) {
    out[key] = fields[key];
  }
  return out;
}

function canonicalMutation(m?: Record<string, unknown>): unknown {
  if (!m) return null;
  return sortKeysDeep(m);
}

/** Subtree for an input-attached block: inputs recurse; `next` is ignored. */
function blockInputSubtree(
  blocks: Record<string, ScratchBlockSpikeV0>,
  id: string,
  visiting: Set<string>,
): Record<string, unknown> {
  if (visiting.has(id)) {
    throw new EquivalenceGraphError(`Cycle detected at block ${id}`);
  }
  const b = blocks[id];
  if (!b) {
    throw new EquivalenceGraphError(`Missing block reference ${id}`);
  }

  visiting.add(id);

  const inputsCanon: Record<string, unknown> = {};
  for (const slot of Object.keys(b.inputs ?? {}).sort()) {
    inputsCanon[slot] = canonicalInput(blocks, slot, b.inputs[slot], visiting);
  }

  visiting.delete(id);

  return {
    opcode: b.opcode,
    fields: canonicalFields(b.fields ?? {}),
    inputs: inputsCanon,
    mutation: canonicalMutation(b.mutation),
    shadow: b.shadow ?? false,
  };
}

function canonicalInput(
  blocks: Record<string, ScratchBlockSpikeV0>,
  slot: string,
  input: unknown,
  visiting: Set<string>,
): unknown {
  if (!Array.isArray(input)) {
    throw new EquivalenceGraphError(`Invalid input on slot ${slot}`);
  }

  const mode = input[0];
  if (mode === 1) {
    const rest = input[1];
    if (Array.isArray(rest)) {
      return { mode: 1, primitive: rest };
    }
    if (typeof rest === "string") {
      return {
        mode: 1,
        slot,
        child: blockInputSubtree(blocks, rest, new Set(visiting)),
      };
    }
    return { mode: 1, value: rest };
  }

  if (mode === 2) {
    const ref = input[1];
    if (typeof ref !== "string") {
      throw new EquivalenceGraphError(`Invalid substack reference on slot ${slot}`);
    }
    return {
      mode: 2,
      slot,
      chain: blockScriptChain(blocks, ref, new Set(visiting)),
    };
  }

  if (mode === 3) {
    const ref = input[1];
    if (typeof ref !== "string") {
      throw new EquivalenceGraphError(`Invalid nested reference on slot ${slot}`);
    }
    const extras = input.slice(2).map((part, index) => {
      if (typeof part === "string") {
        return {
          index,
          child: blockInputSubtree(blocks, part, new Set(visiting)),
        };
      }
      return { index, value: part };
    });
    return {
      mode: 3,
      slot,
      child: blockInputSubtree(blocks, ref, new Set(visiting)),
      extras,
    };
  }

  throw new EquivalenceGraphError(`Unknown input mode ${String(mode)} on slot ${slot}`);
}

/** Linear script chain from root: follows `next`; each block includes input subtrees. */
function blockScriptChain(
  blocks: Record<string, ScratchBlockSpikeV0>,
  id: string | null,
  chainVisited: Set<string>,
): unknown {
  if (!id) return null;
  if (chainVisited.has(id)) {
    throw new EquivalenceGraphError(`Cycle detected at block ${id}`);
  }
  const b = blocks[id];
  if (!b) {
    throw new EquivalenceGraphError(`Missing block reference ${id}`);
  }

  chainVisited.add(id);

  const inputsCanon: Record<string, unknown> = {};
  for (const slot of Object.keys(b.inputs ?? {}).sort()) {
    inputsCanon[slot] = canonicalInput(blocks, slot, b.inputs[slot], new Set());
  }

  const next = blockScriptChain(blocks, b.next, chainVisited);
  chainVisited.delete(id);

  return {
    opcode: b.opcode,
    fields: canonicalFields(b.fields ?? {}),
    inputs: inputsCanon,
    mutation: canonicalMutation(b.mutation),
    shadow: b.shadow ?? false,
    next,
  };
}

/** Stable fingerprint for one top-level script (UID-independent). */
export function scriptFingerprint(
  blocks: Record<string, ScratchBlockSpikeV0>,
  rootId: string,
): string {
  const root = blocks[rootId];
  if (!root) {
    throw new EquivalenceGraphError(`Missing script root ${rootId}`);
  }
  if (!root.topLevel) {
    throw new EquivalenceGraphError(`Block ${rootId} is not top-level`);
  }

  return stableJson({
    topLevel: true,
    x: root.x ?? 0,
    y: root.y ?? 0,
    chain: blockScriptChain(blocks, rootId, new Set()),
  });
}

/** Sorted multiset of top-level script fingerprints (Design §6.7). */
export function scriptRootFingerprints(
  blocks: Record<string, ScratchBlockSpikeV0>,
): string[] {
  const fps: string[] = [];
  for (const [id, b] of Object.entries(blocks)) {
    if (b.topLevel) fps.push(scriptFingerprint(blocks, id));
  }
  return fps.sort();
}
