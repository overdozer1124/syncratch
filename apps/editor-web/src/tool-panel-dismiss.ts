/** True when a pointer target is outside every open tool panel. */
export function shouldCloseToolPanelsOnOutsideTarget(
  target: EventTarget | null,
  panels: ReadonlyArray<HTMLDetailsElement>,
): boolean {
  const openPanels = panels.filter(panel => panel.open);
  if (openPanels.length === 0) return false;
  if (target == null) return true;
  if (typeof Node !== "undefined" && !(target instanceof Node)) return true;
  return openPanels.every(panel => !panel.contains(target as Node));
}

export function closeOpenToolPanels(
  panels: ReadonlyArray<HTMLDetailsElement>,
): void {
  for (const panel of panels) {
    panel.open = false;
  }
}

export function shouldCloseToolPanelsOnKey(key: string): boolean {
  return key === "Escape";
}
