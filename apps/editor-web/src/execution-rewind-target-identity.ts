export type StableTargetLike = {
  id?: string;
  isStage?: boolean;
  getName?: () => string;
  layerOrder?: number;
  cloneIndex?: number;
  isOriginal?: boolean;
};

/** Stable target identity that survives loadProject target id regeneration. */
export function stableTargetIdentity(target: StableTargetLike): string {
  const name = (() => {
    try {
      return target.getName?.() ?? "";
    } catch {
      return "";
    }
  })();
  if (target.isStage) return `stage:${name}`;
  const layer =
    typeof target.layerOrder === "number" ? String(target.layerOrder) : "0";
  const clone =
    typeof target.cloneIndex === "number"
      ? String(target.cloneIndex)
      : target.isOriginal === false
        ? "clone"
        : "orig";
  return `sprite:${name}:${layer}:${clone}`;
}
