export type LocalSaveState =
  | "clean"
  | "dirty"
  | "saving"
  | "error"
  | "conflict";

export interface SaveCoordinator {
  getState(): LocalSaveState;
  markDirty(): void;
  flush(): Promise<void>;
  dispose(): void;
}

export interface SaveCoordinatorOptions {
  debounceMs: number;
  save: () => Promise<void>;
  onState?: (state: LocalSaveState) => void;
}

export function createSaveCoordinator(
  options: SaveCoordinatorOptions,
): SaveCoordinator {
  let state: LocalSaveState = "clean";
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  let disposed = false;

  const setState = (next: LocalSaveState): void => {
    if (disposed) return;
    state = next;
    options.onState?.(next);
  };

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const schedule = (): void => {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void runSave();
    }, options.debounceMs);
  };

  const runSave = async (): Promise<void> => {
    if (disposed) return;
    if (inFlight) {
      await inFlight;
      if (disposed || state !== "dirty") return;
    }
    const sentGeneration = generation;
    setState("saving");
    const work = (async () => {
      try {
        await options.save();
        if (generation === sentGeneration) {
          setState("clean");
        } else {
          setState("dirty");
          schedule();
        }
      } catch (error) {
        const code =
          error && typeof error === "object" && "code" in error
            ? String((error as {code: unknown}).code)
            : "";
        setState(code === "STALE_REVISION" ? "conflict" : "error");
      }
    })();
    inFlight = work.finally(() => {
      inFlight = null;
    });
    await inFlight;
  };

  return {
    getState: () => state,
    markDirty() {
      if (disposed) return;
      generation += 1;
      if (state !== "saving") setState("dirty");
      schedule();
    },
    async flush() {
      if (disposed) return;
      clearTimer();
      await runSave();
      while (!disposed && state === "dirty") {
        clearTimer();
        await runSave();
      }
    },
    dispose() {
      disposed = true;
      clearTimer();
    },
  };
}
