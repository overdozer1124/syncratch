/**
 * Modeless floating AI ask panel: portaled above Scratch chrome, draggable.
 */

export type AiPanelPosition = {left: number; top: number};

export function clampAiPanelPosition(params: {
  left: number;
  top: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  margin?: number;
}): AiPanelPosition {
  const margin = params.margin ?? 8;
  const maxLeft = Math.max(
    margin,
    params.viewportWidth - params.width - margin,
  );
  const maxTop = Math.max(
    margin,
    params.viewportHeight - params.height - margin,
  );
  return {
    left: Math.min(Math.max(params.left, margin), maxLeft),
    top: Math.min(Math.max(params.top, margin), maxTop),
  };
}

export function defaultAiPanelPosition(params: {
  width: number;
  viewportWidth: number;
  toolbarOffsetPx?: number;
  rightGutterPx?: number;
}): AiPanelPosition {
  const toolbarOffsetPx = params.toolbarOffsetPx ?? 72;
  const rightGutterPx = params.rightGutterPx ?? 12;
  return {
    left: Math.max(
      8,
      params.viewportWidth - params.width - rightGutterPx,
    ),
    top: toolbarOffsetPx,
  };
}

function applyPosition(content: HTMLElement, position: AiPanelPosition): void {
  content.style.left = `${position.left}px`;
  content.style.top = `${position.top}px`;
  content.style.right = "auto";
}

type AiFloatingViewport = Pick<
  Window,
  "innerWidth" | "innerHeight" | "addEventListener" | "removeEventListener"
>;

export function installAiFloatingPanel(options: {
  panel: HTMLDetailsElement;
  content: HTMLElement;
  handle: HTMLElement;
  closeButton: HTMLButtonElement;
  /** Optional host; defaults to document.body for stacking above Scratch. */
  portalHost?: HTMLElement;
  /** Injectable for unit tests (defaults to window). */
  viewport?: AiFloatingViewport;
}): () => void {
  const {panel, content, handle, closeButton} = options;
  const portalHost = options.portalHost ?? document.body;
  const viewport = options.viewport ?? window;
  let savedPosition: AiPanelPosition | null = null;
  let drag:
    | {
        pointerId: number;
        startX: number;
        startY: number;
        originLeft: number;
        originTop: number;
      }
    | null = null;

  content.classList.add("ai-floating-panel");
  content.setAttribute("role", "dialog");
  content.setAttribute("aria-modal", "false");
  content.setAttribute("aria-labelledby", "ai-panel-title");

  const placeInPortal = (): void => {
    if (content.parentElement !== portalHost) {
      portalHost.appendChild(content);
    }
  };

  const syncOpen = (): void => {
    const open = panel.open && !panel.hidden;
    content.classList.toggle("is-open", open);
    content.hidden = !open;
    if (!open) return;

    placeInPortal();
    const rect = content.getBoundingClientRect();
    const width = rect.width || Math.min(500, window.innerWidth * 0.96);
    const height = rect.height || Math.min(520, window.innerHeight * 0.7);
    const next =
      savedPosition ??
      defaultAiPanelPosition({
        width,
        viewportWidth: viewport.innerWidth,
      });
    const clamped = clampAiPanelPosition({
      ...next,
      width,
      height,
      viewportWidth: viewport.innerWidth,
      viewportHeight: viewport.innerHeight,
    });
    savedPosition = clamped;
    applyPosition(content, clamped);
  };

  const onToggle = (): void => {
    syncOpen();
  };

  const onCloseClick = (): void => {
    panel.open = false;
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
    const rect = content.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: rect.left,
      originTop: rect.top,
    };
    handle.setPointerCapture(event.pointerId);
    content.classList.add("is-dragging");
    event.preventDefault();
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const rect = content.getBoundingClientRect();
    const next = clampAiPanelPosition({
      left: drag.originLeft + (event.clientX - drag.startX),
      top: drag.originTop + (event.clientY - drag.startY),
      width: rect.width,
      height: rect.height,
      viewportWidth: viewport.innerWidth,
      viewportHeight: viewport.innerHeight,
    });
    savedPosition = next;
    applyPosition(content, next);
  };

  const endDrag = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag = null;
    content.classList.remove("is-dragging");
    if (handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId);
    }
  };

  const onResize = (): void => {
    if (!content.classList.contains("is-open") || !savedPosition) return;
    const rect = content.getBoundingClientRect();
    const clamped = clampAiPanelPosition({
      ...savedPosition,
      width: rect.width,
      height: rect.height,
      viewportWidth: viewport.innerWidth,
      viewportHeight: viewport.innerHeight,
    });
    savedPosition = clamped;
    applyPosition(content, clamped);
  };

  panel.addEventListener("toggle", onToggle);
  closeButton.addEventListener("click", onCloseClick);
  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", endDrag);
  handle.addEventListener("pointercancel", endDrag);
  viewport.addEventListener("resize", onResize);

  // Initial sync (panel may already be open in tests).
  syncOpen();

  return () => {
    panel.removeEventListener("toggle", onToggle);
    closeButton.removeEventListener("click", onCloseClick);
    handle.removeEventListener("pointerdown", onPointerDown);
    handle.removeEventListener("pointermove", onPointerMove);
    handle.removeEventListener("pointerup", endDrag);
    handle.removeEventListener("pointercancel", endDrag);
    viewport.removeEventListener("resize", onResize);
  };
}
