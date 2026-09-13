import type {JournalEntry} from "./execution-rewind-types.js";
import type {RewindJournal} from "./execution-rewind-journal.js";
import {RewindJournalMismatchError} from "./execution-rewind-journal.js";
import {
  getSpriteName,
  type StableTargetLike,
} from "./execution-rewind-target-identity.js";

export type CloneOrderTargetLike = StableTargetLike & {
  isOriginal?: boolean;
};

export type CloneOrderRuntimeLike = {
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  off?: (event: string, handler: (...args: unknown[]) => void) => void;
  targets?: CloneOrderTargetLike[];
};

type CloneOrderJournalEntry = Extract<JournalEntry, {kind: "cloneOrder"}>;

/** Assigns stable clone sequence numbers independent of runtime cloneIndex/layerOrder. */
export class CloneOrderRegistry {
  private readonly cloneOrderByTarget = new WeakMap<object, number>();
  private readonly nextCloneOrderBySprite = new Map<string, number>();

  reset(): void {
    this.nextCloneOrderBySprite.clear();
  }

  seedOriginalTargets(targets: CloneOrderTargetLike[] | undefined): void {
    for (const target of targets ?? []) {
      if (target.isStage) continue;
      const spriteName = getSpriteName(target);
      if (!spriteName) continue;
      if (!this.cloneOrderByTarget.has(target)) {
        this.cloneOrderByTarget.set(target, 0);
        this.nextCloneOrderBySprite.set(spriteName, 1);
      }
    }
  }

  getCloneOrder(target: StableTargetLike | null | undefined): number | undefined {
    if (!target || typeof target !== "object") return undefined;
    return this.cloneOrderByTarget.get(target);
  }

  assignCloneOrder(
    target: CloneOrderTargetLike,
    sourceTarget?: CloneOrderTargetLike,
  ): number {
    const spriteName = getSpriteName(target);
    if (!spriteName) {
      throw new Error("Clone target is missing a sprite name");
    }

    if (sourceTarget && target.isOriginal !== false) {
      // Runtime clones always report isOriginal=false, but keep the guard explicit.
      target.isOriginal = false;
    }

    const existing = this.cloneOrderByTarget.get(target);
    if (typeof existing === "number") return existing;

    if (target.isOriginal !== false && !sourceTarget) {
      this.cloneOrderByTarget.set(target, 0);
      this.nextCloneOrderBySprite.set(spriteName, 1);
      return 0;
    }

    const order = this.nextCloneOrderBySprite.get(spriteName) ?? 1;
    this.cloneOrderByTarget.set(target, order);
    this.nextCloneOrderBySprite.set(spriteName, order + 1);
    return order;
  }

  assignFromJournal(
    target: CloneOrderTargetLike,
    entry: CloneOrderJournalEntry,
  ): number {
    const spriteName = getSpriteName(target);
    if (!spriteName || spriteName !== entry.spriteName) {
      throw new RewindJournalMismatchError(
        `Clone order sprite mismatch: expected ${entry.spriteName}, got ${spriteName ?? "none"}`,
      );
    }
    if (entry.cloneOrder <= 0) {
      throw new RewindJournalMismatchError(
        `Clone order journal entry must be > 0, got ${entry.cloneOrder}`,
      );
    }

    this.cloneOrderByTarget.set(target, entry.cloneOrder);
    const next = Math.max(
      this.nextCloneOrderBySprite.get(spriteName) ?? 1,
      entry.cloneOrder + 1,
    );
    this.nextCloneOrderBySprite.set(spriteName, next);
    if (target.isOriginal !== false) {
      target.isOriginal = false;
    }
    return entry.cloneOrder;
  }
}

export function installCloneOrderCapture(input: {
  runtime: CloneOrderRuntimeLike;
  registry: CloneOrderRegistry;
  journal: RewindJournal;
}): () => void {
  const {runtime, registry, journal} = input;
  registry.reset();
  registry.seedOriginalTargets(runtime.targets);

  const onTargetCreated = (
    newTarget: CloneOrderTargetLike,
    sourceTarget?: CloneOrderTargetLike,
  ) => {
    const mode = journal.getMode();
    const spriteName = getSpriteName(newTarget);
    if (!spriteName || newTarget.isStage) return;

    if (mode === "replay") {
      const entry = journal.consume("cloneOrder");
      if (!entry || entry.kind !== "cloneOrder") {
        throw new RewindJournalMismatchError("Expected cloneOrder journal entry");
      }
      registry.assignFromJournal(newTarget, entry);
      return;
    }

    const cloneOrder = registry.assignCloneOrder(newTarget, sourceTarget);
    if (mode === "record" && cloneOrder > 0) {
      journal.append({
        kind: "cloneOrder",
        spriteName,
        cloneOrder,
        sourceIdentity: sourceTarget
          ? stableTargetIdentityFromRegistry(sourceTarget, registry)
          : `sprite:${spriteName}:orig`,
      });
    }
  };

  const onTargetCreatedHandler = (...args: unknown[]) => {
    onTargetCreated(
      args[0] as CloneOrderTargetLike,
      args[1] as CloneOrderTargetLike | undefined,
    );
  };

  runtime.on?.("targetWasCreated", onTargetCreatedHandler);

  return () => {
    runtime.off?.("targetWasCreated", onTargetCreatedHandler);
    registry.reset();
  };
}

function stableTargetIdentityFromRegistry(
  target: StableTargetLike,
  registry: CloneOrderRegistry,
): string {
  const spriteName = getSpriteName(target);
  if (target.isStage) return `stage:${spriteName}`;
  const order = registry.getCloneOrder(target);
  if (order === 0 || (order === undefined && target.isOriginal !== false)) {
    return `sprite:${spriteName}:orig`;
  }
  if (typeof order === "number" && order > 0) {
    return `sprite:${spriteName}:clone:${order}`;
  }
  return target.isOriginal === false
    ? `sprite:${spriteName}:clone:unknown`
    : `sprite:${spriteName}:orig`;
}
