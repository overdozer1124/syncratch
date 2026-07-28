/**
 * Modeless debug panel for pause / rewind / trace: portaled above Scratch,
 * draggable, does not block the stage.
 */

import {
  clampAiPanelPosition,
  type AiPanelPosition,
} from "./ai-floating-panel.js";

export type DebugPanelPosition = AiPanelPosition;

export function defaultDebugPanelPosition(params: {
  width: number;
  viewportWidth: number;
  viewportHeight: number;
  toolbarOffsetPx?: number;
  marginPx?: number;
}): DebugPanelPosition {
  const marginPx = params.marginPx ?? 16;
  const toolbarOffsetPx = params.toolbarOffsetPx ?? 72;
  return {
    left: Math.max(
      marginPx,
      params.viewportWidth - params.width - marginPx,
    ),
    top: Math.min(
      Math.max(toolbarOffsetPx, params.viewportHeight * 0.38),
      params.viewportHeight - 280,
    ),
  };
}

function applyPosition(content: HTMLElement, position: DebugPanelPosition): void {
  content.style.left = `${position.left}px`;
  content.style.top = `${position.top}px`;
  content.style.right = "auto";
}

type DebugFloatingViewport = Pick<
  Window,
  "innerWidth" | "innerHeight" | "addEventListener" | "removeEventListener"
>;

export interface DebugFloatingPanelController {
  isOpen(): boolean;
  setOpen(open: boolean): void;
  dispose(): void;
}

export function installDebugFloatingPanel(options: {
  panel: HTMLElement;
  handle: HTMLElement;
  closeButton: HTMLButtonElement;
  portalHost?: HTMLElement;
  viewport?: DebugFloatingViewport;
}): DebugFloatingPanelController {
  const {panel, handle, closeButton} = options;
  const portalHost = options.portalHost ?? document.body;
  const viewport = options.viewport ?? window;
  let open = false;
  let savedPosition: DebugPanelPosition | null = null;
  let drag:
    | {
        pointerId: number;
        startX: number;
        startY: number;
        originLeft: number;
        originTop: number;
      }
    | null = null;

  panel.classList.add("debug-floating-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "false");
  panel.setAttribute("aria-labelledby", "exec-debug-title");

  const placeInPortal = (): void => {
    if (panel.parentElement !== portalHost) {
      portalHost.appendChild(panel);
    }
  };

  const syncVisibility = (): void => {
    panel.classList.toggle("is-open", open);
    panel.hidden = !open;
    if (!open) return;

    placeInPortal();
    const rect = panel.getBoundingClientRect();
    const width = rect.width || Math.min(380, viewport.innerWidth * 0.96);
    const height = rect.height || Math.min(420, viewport.innerHeight * 0.55);
    const next =
      savedPosition ??
      defaultDebugPanelPosition({
        width,
        viewportWidth: viewport.innerWidth,
        viewportHeight: viewport.innerHeight,
      });
    const clamped = clampAiPanelPosition({
      ...next,
      width,
      height,
      viewportWidth: viewport.innerWidth,
      viewportHeight: viewport.innerHeight,
    });
    savedPosition = clamped;
    applyPosition(panel, clamped);
  };

  const setOpen = (next: boolean): void => {
    if (open === next) return;
    open = next;
    syncVisibility();
  };

  const onCloseClick = (): void => {
    setOpen(false);
  };

  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    const target = event.target;
    if (
      typeof Element !== "undefined" &&
      target instanceof Element &&
      target.closest("button, a, input, select, textarea, label")
    ) {
      return;
    }
    const rect = panel.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: rect.left,
      originTop: rect.top,
    };
    handle.setPointerCapture(event.pointerId);
    panel.classList.add("is-dragging");
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const rect = panel.getBoundingClientRect();
    const next = clampAiPanelPosition({
      left: drag.originLeft + (event.clientX - drag.startX),
      top: drag.originTop + (event.clientY - drag.startY),
      width: rect.width,
      height: rect.height,
      viewportWidth: viewport.innerWidth,
      viewportHeight: viewport.innerHeight,
    });
    savedPosition = next;
    applyPosition(panel, next);
  };

  const endDrag = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    panel.classList.remove("is-dragging");
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
  };

  const onResize = (): void => {
    if (!open || !savedPosition) return;
    const rect = panel.getBoundingClientRect();
    const clamped = clampAiPanelPosition({
      ...savedPosition,
      width: rect.width,
      height: rect.height,
      viewportWidth: viewport.innerWidth,
      viewportHeight: viewport.innerHeight,
    });
    savedPosition = clamped;
    applyPosition(panel, clamped);
  };

  closeButton.addEventListener("click", onCloseClick);
  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
  viewport.addEventListener("resize", onResize);

  syncVisibility();

  return {
    isOpen: () => open,
    setOpen,
    dispose: () => {
      setOpen(false);
      closeButton.removeEventListener("click", onCloseClick);
      handle.removeEventListener("pointerdown", onPointerDown);
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", endDrag);
      handle.removeEventListener("pointercancel", endDrag);
      viewport.removeEventListener("resize", onResize);
    },
  };
}
