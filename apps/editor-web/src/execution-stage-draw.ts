export type StageDrawRuntimeLike = {
  renderer?: {draw?: () => unknown} | null;
};

/** Best-effort stage repaint without advancing VM threads. */
export function requestRuntimeStageDraw(runtime: unknown): void {
  try {
    const candidate = runtime as StageDrawRuntimeLike | null | undefined;
    candidate?.renderer?.draw?.();
  } catch {
    // Repaint must never break pause/replay control flow.
  }
}
