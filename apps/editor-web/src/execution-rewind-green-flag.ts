export type GreenFlagRuntimeLike = {
  targets?: Array<{
    clearEdgeActivatedValues?: () => void;
    onGreenFlag?: () => void;
  }>;
  ioDevices?: {
    clock?: {
      resetProjectTimer?: () => void;
    };
  };
  startHats?: (opcode: string) => void;
};

/**
 * Recreate green-flag hat threads after `loadProject()` without emitting
 * `PROJECT_START` or calling `stopAll()`.
 */
export function restartGreenFlagHatThreads(
  runtime: GreenFlagRuntimeLike | null | undefined,
): void {
  if (!runtime) return;
  runtime.ioDevices?.clock?.resetProjectTimer?.();
  for (const target of runtime.targets ?? []) {
    target.clearEdgeActivatedValues?.();
    target.onGreenFlag?.();
  }
  runtime.startHats?.("event_whenflagclicked");
}
