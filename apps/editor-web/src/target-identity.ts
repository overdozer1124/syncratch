import type {ProjectDocument, ScratchTarget} from "@blocksync/project-schema";

function findPreviousTarget(
  target: ScratchTarget,
  previousTargets: ScratchTarget[],
  usedIds: Set<string>,
): ScratchTarget | undefined {
  const available = previousTargets.filter(
    candidate =>
      candidate.isStage === target.isStage && !usedIds.has(candidate.id),
  );
  if (available.length === 0) return undefined;
  if (target.isStage) return available.length === 1 ? available[0] : undefined;

  const sameLayer = available.filter(
    candidate => candidate.layerOrder === target.layerOrder,
  );
  if (sameLayer.length === 1) return sameLayer[0];

  const sameName = available.filter(candidate => candidate.name === target.name);
  if (sameName.length === 1) return sameName[0];

  return available.length === 1 ? available[0] : undefined;
}

/**
 * SB3 target IDs are derived from names during conversion. Preserve the
 * collaboration IDs across VM snapshots so renaming a target remains an edit
 * to that target instead of appearing as a delete plus an unrelated addition.
 */
export function preserveTargetIds(
  previous: ProjectDocument,
  converted: ProjectDocument,
): ProjectDocument {
  const usedIds = new Set<string>();
  const targets = converted.targets.map(target => {
    const prior = findPreviousTarget(target, previous.targets, usedIds);
    if (!prior) return target;
    usedIds.add(prior.id);
    return {...target, id: prior.id};
  });
  return {...converted, targets};
}
