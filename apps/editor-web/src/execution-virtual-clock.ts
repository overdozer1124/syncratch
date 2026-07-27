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

/** Keeps runtime.currentMSecs from advancing while execution is paused. */
export function installVirtualClock(
  runtime: VirtualClockRuntimeLike,
): VirtualClockController | null {
  if ((runtime as Record<string, unknown>)[VIRTUAL_CLOCK_FLAG]) {
    return null;
  }
  if (typeof runtime.updateCurrentMSecs !== "function") return null;

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
    },
    unfreeze() {
      if (!frozen) return;
      frozen = false;
      virtualBaseWall = Date.now();
      runtime.currentMSecs = virtualBaseMSecs;
    },
    dispose() {
      runtime.updateCurrentMSecs = originalUpdate;
      (runtime as Record<string, unknown>)[VIRTUAL_CLOCK_FLAG] = false;
    },
  };
}
