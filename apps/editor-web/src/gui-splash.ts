export type GuiSplashProgress = {
  /** 0–1 */
  ratio: number;
  label: string;
};

export function setGuiSplashVisible(
  splash: HTMLElement | null,
  visible: boolean,
): void {
  if (!splash) return;
  splash.toggleAttribute("hidden", !visible);
  splash.setAttribute("aria-busy", visible ? "true" : "false");
}

export function setGuiSplashProgress(
  splash: HTMLElement | null,
  progress: GuiSplashProgress,
): void {
  if (!splash) return;
  const clamped = Math.min(1, Math.max(0, progress.ratio));
  const pct = Math.round(clamped * 100);
  const bar = splash.querySelector<HTMLElement>("[data-splash-progress-bar]");
  const meter = splash.querySelector<HTMLElement>("[data-splash-progress]");
  const status = splash.querySelector<HTMLElement>("[data-splash-status]");
  if (bar) bar.style.setProperty("--progress", `${pct}%`);
  if (meter) meter.setAttribute("aria-valuenow", String(pct));
  if (status) status.textContent = progress.label;
}
