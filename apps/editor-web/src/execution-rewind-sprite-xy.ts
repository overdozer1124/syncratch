import type {RewindJournal} from "./execution-rewind-journal.js";
import {RewindJournalMismatchError} from "./execution-rewind-journal.js";

export type SpriteXYTargetLike = {
  x?: number;
  y?: number;
  isStage?: boolean;
  setXY?: (x: number, y: number, force?: boolean) => void;
};

export type SpriteXYRuntimeLike = {
  targets?: SpriteXYTargetLike[];
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  off?: (event: string, handler: (...args: unknown[]) => void) => void;
};

const SPRITE_XY_FLAG = "__syncratchRewindSpriteXYInstalled";
const SPRITE_XY_JOURNAL = "__syncratchRewindSpriteXYJournal";
const SPRITE_XY_WRAPPED = "__syncratchRewindSpriteXYWrapped";

type SpriteXYJournalEntry = {
  kind: "spriteXY";
  requestedX: number;
  requestedY: number;
  x: number;
  y: number;
};

type RuntimeSlots = SpriteXYRuntimeLike & Record<string, unknown>;

function readJournal(runtime: RuntimeSlots): RewindJournal | null {
  const journal = runtime[SPRITE_XY_JOURNAL];
  return journal ? (journal as RewindJournal) : null;
}

function toCoord(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function isMatchingSpriteXY(
  entry: {kind?: string; requestedX?: number; requestedY?: number} | null,
  requestedX: number,
  requestedY: number,
): entry is SpriteXYJournalEntry {
  return (
    entry?.kind === "spriteXY" &&
    entry.requestedX === requestedX &&
    entry.requestedY === requestedY
  );
}

/**
 * Journal `setXY` results only when the renderer (or drag lock) changes the
 * requested coordinates. Replay matches those entries by the *requested*
 * x/y so an unfenced `motion_movesteps` in the same frame does not consume
 * the fenced `motion_gotoxy` that follows (`もし` then-branch teleport).
 *
 * After `loadProject()`, drawable/skin bounds are often missing, so replay
 * would otherwise apply unfenced x and take a different `control_if` branch
 * or land at a different goto destination.
 */
export function installSpriteXYCapture(input: {
  runtime: SpriteXYRuntimeLike;
  journal: RewindJournal;
}): {dispose: () => void; ensureWrapped: () => void} {
  const runtime = input.runtime as RuntimeSlots;
  runtime[SPRITE_XY_JOURNAL] = input.journal;

  const wrapTarget = (target: SpriteXYTargetLike | null | undefined) => {
    if (!target || typeof target !== "object") return;
    if (target.isStage) return;
    if (typeof target.setXY !== "function") return;
    if ((target as Record<string, unknown>)[SPRITE_XY_WRAPPED]) return;

    const original = target.setXY.bind(target);
    target.setXY = (x: number, y: number, force?: boolean) => {
      const journal = readJournal(runtime);
      const mode = journal?.getMode() ?? "idle";
      const requestedX = toCoord(x);
      const requestedY = toCoord(y);
      if (mode === "replay" && journal) {
        const peek = journal.peekReplayEntry();
        if (isMatchingSpriteXY(peek, requestedX, requestedY)) {
          const entry = journal.consume("spriteXY");
          if (!entry || entry.kind !== "spriteXY") {
            throw new RewindJournalMismatchError(
              "Expected spriteXY journal entry",
            );
          }
          original(entry.x, entry.y, force);
          target.x = entry.x;
          target.y = entry.y;
          return;
        }
        original(x, y, force);
        return;
      }
      original(x, y, force);
      if (mode === "record" && journal) {
        const actualX = toCoord(target.x);
        const actualY = toCoord(target.y);
        if (actualX !== requestedX || actualY !== requestedY) {
          journal.append({
            kind: "spriteXY",
            requestedX,
            requestedY,
            x: actualX,
            y: actualY,
          } satisfies SpriteXYJournalEntry);
        }
      }
    };
    (target as Record<string, unknown>)[SPRITE_XY_WRAPPED] = true;
  };

  const ensureWrapped = () => {
    for (const target of runtime.targets ?? []) {
      wrapTarget(target);
    }
  };

  const onTargetCreated = (...args: unknown[]) => {
    wrapTarget(args[0] as SpriteXYTargetLike);
    wrapTarget(args[1] as SpriteXYTargetLike);
  };

  if (runtime[SPRITE_XY_FLAG]) {
    ensureWrapped();
    return {
      ensureWrapped,
      dispose() {
        runtime[SPRITE_XY_JOURNAL] = null;
      },
    };
  }

  ensureWrapped();
  runtime.on?.("targetWasCreated", onTargetCreated);
  runtime[SPRITE_XY_FLAG] = true;

  return {
    ensureWrapped,
    dispose() {
      runtime.off?.("targetWasCreated", onTargetCreated);
      runtime[SPRITE_XY_FLAG] = false;
      runtime[SPRITE_XY_JOURNAL] = null;
    },
  };
}
