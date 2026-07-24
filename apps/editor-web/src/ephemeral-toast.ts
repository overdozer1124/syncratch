/**
 * Short-lived status popup (outside tool panels so it stays visible after close).
 */

export const EPHEMERAL_TOAST_DEFAULT_MS = 2000;

export interface EphemeralToastController {
  show(message: string, durationMs?: number): void;
  hide(): void;
  dispose(): void;
}

export function createEphemeralToast(
  root: HTMLElement,
  options?: {
    schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
    cancel?: (id: ReturnType<typeof setTimeout>) => void;
  },
): EphemeralToastController {
  const schedule = options?.schedule ?? setTimeout;
  const cancel = options?.cancel ?? clearTimeout;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const hide = (): void => {
    if (timer !== undefined) {
      cancel(timer);
      timer = undefined;
    }
    root.classList.remove("is-visible");
    root.hidden = true;
    root.textContent = "";
  };

  const show = (message: string, durationMs = EPHEMERAL_TOAST_DEFAULT_MS): void => {
    const text = message.trim();
    if (!text) {
      hide();
      return;
    }
    if (timer !== undefined) {
      cancel(timer);
      timer = undefined;
    }
    root.textContent = text;
    root.hidden = false;
    root.classList.add("is-visible");
    timer = schedule(() => {
      timer = undefined;
      hide();
    }, durationMs);
  };

  return {
    show,
    hide,
    dispose: hide,
  };
}
