import type {ScratchTarget} from "@blocksync/project-schema";

/**
 * Score how "assembled" a target's block graph is. Mid-drag forever stacks
 * (one body block + detached siblings) score lower than a fully nested stack.
 * Used to prefer complete snapshots over incomplete LWW winners.
 */
export function blockConnectivityScore(target: ScratchTarget): number {
  const blocks = target.blocks ?? {};
  let score = Object.keys(blocks).length;
  for (const block of Object.values(blocks)) {
    if (!block || typeof block !== "object") continue;
    const record = block as {
      next?: string | null;
      parent?: string | null;
      topLevel?: boolean;
      inputs?: Record<string, unknown>;
    };
    if (record.next) score += 2;
    if (record.parent) score += 2;
    if (record.topLevel) score += 1;
    for (const value of Object.values(record.inputs ?? {})) {
      if (!Array.isArray(value)) continue;
      // Scratch shadow/block refs: [type, blockId] or nested structures.
      if (typeof value[1] === "string" && value[1].length > 0) score += 3;
      if (Array.isArray(value[1]) && typeof value[1][1] === "string") score += 3;
    }
  }
  return score;
}

export function parseTargetJson(json: unknown): ScratchTarget | null {
  if (typeof json !== "string") return null;
  try {
    const parsed = JSON.parse(json) as ScratchTarget;
    if (!parsed || typeof parsed !== "object" || typeof parsed.id !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** True when `candidate` has the same block ids but a weaker nesting/graph. */
export function isWeakerBlockGraph(
  candidate: ScratchTarget,
  champion: ScratchTarget,
): boolean {
  const candidateIds = Object.keys(candidate.blocks ?? {});
  const championIds = new Set(Object.keys(champion.blocks ?? {}));
  if (candidateIds.length === 0 || championIds.size === 0) return false;
  if (candidateIds.length !== championIds.size) return false;
  for (const id of candidateIds) {
    if (!championIds.has(id)) return false;
  }
  return blockConnectivityScore(candidate) < blockConnectivityScore(champion);
}
