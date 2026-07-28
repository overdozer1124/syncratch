export type StageDrawRuntimeLike = {
  renderer?: {draw?: () => unknown} | null;
};

/** Best-effort stage repaint without advancing VM threads. */
export function requestRuntimeStageDraw(
  runtime: StageDrawRuntimeLike | null | undefined,
): void {
  try {
    runtime?.renderer?.draw?.();
  } catch {
    // Repaint must never break pause/replay control flow.
  }
}
