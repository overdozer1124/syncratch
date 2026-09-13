import type {CloneOrderRegistry} from "./execution-rewind-clone-order.js";

export type StableTargetLike = {
  id?: string;
  isStage?: boolean;
  isOriginal?: boolean;
  getName?: () => string;
};

let activeCloneOrderRegistry: CloneOrderRegistry | null = null;

/** Bind the active clone-order registry used by {@link stableTargetIdentity}. */
export function bindCloneOrderRegistry(registry: CloneOrderRegistry | null): void {
  activeCloneOrderRegistry = registry;
}

export function getSpriteName(target: StableTargetLike): string {
  try {
    return target.getName?.() ?? "";
  } catch {
    return "";
  }
}

/** Stable target identity that survives loadProject target id regeneration. */
export function stableTargetIdentity(target: StableTargetLike): string {
  const name = getSpriteName(target);
  if (target.isStage) return `stage:${name}`;

  const order = activeCloneOrderRegistry?.getCloneOrder(target);
  if (order === 0) return `sprite:${name}:orig`;
  if (typeof order === "number" && order > 0) {
    return `sprite:${name}:clone:${order}`;
  }

  if (target.isOriginal === false) {
    return `sprite:${name}:clone:unknown`;
  }
  return `sprite:${name}:orig`;
}
