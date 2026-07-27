export type VirtualClockRuntimeLike = {
  currentMSecs?: number;
  updateCurrentMSecs?: () => void;
};

const VIRTUAL_CLOCK_FLAG = "__syncratchVirtualClockInstalled";

export type VirtualClockController = {
  freeze(): void;
  unfreeze(): void;
  dispose(): void;
};

type TimerHandle = number;

type TimerEntry = {
  callback: () => void;
  remainingMs: number;
  nativeId?: ReturnType<typeof setTimeout>;
  deadlineWall?: number;
};

let timerCounter = 1;
const activeTimers = new Map<TimerHandle, TimerEntry>();
let timersFrozen = false;
let timersPatched = false;
let originalSetTimeout: typeof setTimeout | undefined;
let originalClearTimeout: typeof clearTimeout | undefined;

function armTimer(id: TimerHandle): void {
  const entry = activeTimers.get(id);
  if (!entry || timersFrozen || !originalSetTimeout || !originalClearTimeout) {
    return;
  }
  if (entry.nativeId !== undefined) {
    originalClearTimeout(entry.nativeId);
  }
  entry.deadlineWall = Date.now() + entry.remainingMs;
  entry.nativeId = originalSetTimeout(() => {
    activeTimers.delete(id);
    entry.callback();
  }, entry.remainingMs);
}

function patchTimers(): void {
  if (timersPatched) return;
  originalSetTimeout = globalThis.setTimeout.bind(globalThis);
  originalClearTimeout = globalThis.clearTimeout.bind(globalThis);

  globalThis.setTimeout = ((
    callback: TimerHandler,
    delay?: number,
    ...args: unknown[]
  ) => {
    const id = timerCounter;
    timerCounter += 1;
    const entry: TimerEntry = {
      callback: () => {
        if (typeof callback === "function") {
          callback(...args);
        }
      },
      remainingMs: Math.max(0, Number(delay) || 0),
    };
    activeTimers.set(id, entry);
    if (!timersFrozen) {
      armTimer(id);
    }
    return id as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;

  globalThis.clearTimeout = ((handle?: ReturnType<typeof setTimeout>) => {
    if (handle === undefined || !originalClearTimeout) return;
    const id = handle as unknown as TimerHandle;
    const entry = activeTimers.get(id);
    if (!entry) return;
    if (entry.nativeId !== undefined) {
      originalClearTimeout(entry.nativeId);
    }
    activeTimers.delete(id);
  }) as typeof clearTimeout;

  timersPatched = true;
}

function freezeTimers(): void {
  timersFrozen = true;
  const now = Date.now();
  for (const [id, entry] of activeTimers) {
    if (entry.nativeId !== undefined && originalClearTimeout) {
      originalClearTimeout(entry.nativeId);
      entry.nativeId = undefined;
    }
    if (entry.deadlineWall !== undefined) {
      entry.remainingMs = Math.max(0, entry.deadlineWall - now);
      entry.deadlineWall = undefined;
    }
    activeTimers.set(id, entry);
  }
}

function unfreezeTimers(): void {
  timersFrozen = false;
  for (const id of activeTimers.keys()) {
    armTimer(id);
  }
}

function restoreTimers(): void {
  if (!timersPatched || !originalClearTimeout) return;
  for (const entry of activeTimers.values()) {
    if (entry.nativeId !== undefined) {
      originalClearTimeout(entry.nativeId);
    }
  }
  activeTimers.clear();
  if (originalSetTimeout) {
    globalThis.setTimeout = originalSetTimeout;
  }
  if (originalClearTimeout) {
    globalThis.clearTimeout = originalClearTimeout;
  }
  timersPatched = false;
  timersFrozen = false;
  timerCounter = 1;
}

/** Keeps runtime.currentMSecs and setTimeout callbacks from advancing while paused. */
export function installVirtualClock(
  runtime: VirtualClockRuntimeLike,
): VirtualClockController | null {
  if ((runtime as Record<string, unknown>)[VIRTUAL_CLOCK_FLAG]) {
    return null;
  }
  if (typeof runtime.updateCurrentMSecs !== "function") return null;

  patchTimers();

  const originalUpdate = runtime.updateCurrentMSecs.bind(runtime);
  let frozen = false;
  let virtualBaseMSecs = runtime.currentMSecs ?? 0;
  let virtualBaseWall = Date.now();

  const syncRunningClock = (): void => {
    const now = Date.now();
    runtime.currentMSecs = virtualBaseMSecs + (now - virtualBaseWall);
    virtualBaseMSecs = runtime.currentMSecs ?? virtualBaseMSecs;
    virtualBaseWall = now;
  };

  runtime.updateCurrentMSecs = () => {
    if (frozen) {
      runtime.currentMSecs = virtualBaseMSecs;
      return;
    }
    syncRunningClock();
  };

  originalUpdate();
  virtualBaseMSecs = runtime.currentMSecs ?? virtualBaseMSecs;
  virtualBaseWall = Date.now();

  (runtime as Record<string, unknown>)[VIRTUAL_CLOCK_FLAG] = true;

  return {
    freeze() {
      if (frozen) return;
      runtime.updateCurrentMSecs?.();
      virtualBaseMSecs = runtime.currentMSecs ?? virtualBaseMSecs;
      frozen = true;
      freezeTimers();
    },
    unfreeze() {
      if (!frozen) return;
      frozen = false;
      virtualBaseWall = Date.now();
      runtime.currentMSecs = virtualBaseMSecs;
      unfreezeTimers();
    },
    dispose() {
      runtime.updateCurrentMSecs = originalUpdate;
      restoreTimers();
      (runtime as Record<string, unknown>)[VIRTUAL_CLOCK_FLAG] = false;
    },
  };
}
