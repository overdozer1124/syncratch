/**
 * Syncratch flyout (ブロックリスト) layout controls:
 * 1. Collapse / expand the continuous flyout while keeping the category rail
 * 2. Temporarily widen the flyout on hover so clipped long blocks are visible
 *
 * Important: ContinuousMetrics reads flyout.getWidth() to place the workspace
 * origin. Hover-expand MUST NOT change getWidth() / workspace.resize(), or
 * placed blocks slide sideways. Hover widening is a visual overlay only.
 * Collapse still uses getWidth() === 0 + setVisible(false).
 */

export const DEFAULT_FLYOUT_WIDTH_PX = 250;
export const MAX_FLYOUT_WIDTH_PX = 480;
export const FLYOUT_WIDTH_PADDING_PX = 28;

export type FlyoutLike = {
  getWidth?: () => number;
  getHeight?: () => number;
  isVisible?: () => boolean;
  setVisible?: (visible: boolean) => void;
  position?: () => void;
  reflow?: () => void;
  getFlyoutScale?: () => number;
  getWorkspace?: () => {
    getAllBlocks?: (ordered?: boolean) => Array<{
      getHeightWidth?: () => {width: number; height: number};
    }>;
  } | null;
  svgGroup_?: Element | null;
};

export type WorkspaceWithFlyout = {
  resize?: () => void;
  isDragging?: () => boolean;
  getFlyout?: () => FlyoutLike | null;
};

export type FlyoutLayoutController = {
  isCollapsed: () => boolean;
  setCollapsed: (collapsed: boolean) => void;
  toggleCollapsed: () => void;
  isHoverExpanded: () => boolean;
  dispose: () => void;
};

export function clampFlyoutWidth(widthPx: number): number {
  if (!Number.isFinite(widthPx)) return DEFAULT_FLYOUT_WIDTH_PX;
  return Math.min(
    MAX_FLYOUT_WIDTH_PX,
    Math.max(DEFAULT_FLYOUT_WIDTH_PX, Math.ceil(widthPx)),
  );
}

/**
 * Width reported to Blockly metrics / getWidth().
 * Hover-expand is intentionally ignored so the workspace origin stays put.
 */
export function computeMetricsFlyoutWidth(options: {
  collapsed: boolean;
  defaultWidthPx?: number;
}): number {
  if (options.collapsed) return 0;
  return options.defaultWidthPx ?? DEFAULT_FLYOUT_WIDTH_PX;
}

/** Visible flyout width (may overlay the workspace when hover-expanded). */
export function computeVisualFlyoutWidth(options: {
  collapsed: boolean;
  hoverExpanded: boolean;
  contentWidthPx: number;
  defaultWidthPx?: number;
}): number {
  if (options.collapsed) return 0;
  const base = options.defaultWidthPx ?? DEFAULT_FLYOUT_WIDTH_PX;
  if (!options.hoverExpanded) return base;
  return clampFlyoutWidth(Math.max(base, options.contentWidthPx));
}

/** @deprecated Use computeVisualFlyoutWidth / computeMetricsFlyoutWidth. */
export function computeFlyoutDisplayWidth(options: {
  collapsed: boolean;
  hoverExpanded: boolean;
  contentWidthPx: number;
  defaultWidthPx?: number;
}): number {
  return computeVisualFlyoutWidth(options);
}

/**
 * Measure how wide the flyout needs to be to show the widest block.
 * Prefers Blockly geometry (unaffected by SVG clipping); falls back to DOM.
 */
export function measureFlyoutContentWidthPx(
  flyout: FlyoutLike,
  flyoutSvg: Element | null = null,
): number {
  const scale = flyout.getFlyoutScale?.() ?? 0.675;
  const workspace = flyout.getWorkspace?.();
  const blocks = workspace?.getAllBlocks?.(false) ?? [];
  let maxBlock = 0;
  for (const block of blocks) {
    const size = block.getHeightWidth?.();
    if (!size || typeof size.width !== "number") continue;
    maxBlock = Math.max(maxBlock, size.width * scale);
  }
  if (maxBlock > 0) {
    return clampFlyoutWidth(maxBlock + FLYOUT_WIDTH_PADDING_PX);
  }

  const svg =
    flyoutSvg ??
    flyout.svgGroup_ ??
    (typeof document !== "undefined"
      ? document.querySelector(".blocklyFlyout")
      : null);
  if (svg && typeof svg.getBoundingClientRect === "function") {
    const host = svg.getBoundingClientRect();
    if (host.width > 0) {
      let maxRight = 0;
      for (const node of svg.querySelectorAll(".blocklyDraggable")) {
        const box = node.getBoundingClientRect();
        if (box.width <= 0) continue;
        maxRight = Math.max(maxRight, box.right - host.left);
      }
      if (maxRight > 0) {
        return clampFlyoutWidth(maxRight + FLYOUT_WIDTH_PADDING_PX);
      }
    }
  }

  return DEFAULT_FLYOUT_WIDTH_PX;
}

/** Collapse-toggle X follows the *visual* flyout edge. */
export function computeToggleEdgeX(options: {
  collapsed: boolean;
  toolboxRightPx: number;
  visualFlyoutWidthPx: number;
}): number {
  if (options.collapsed) return options.toolboxRightPx;
  return options.toolboxRightPx + options.visualFlyoutWidthPx;
}

/** Blockly positions the flyout scrollbar at metrics width; nudge it for hover overlay. */
export function computeFlyoutScrollbarNudgePx(options: {
  collapsed: boolean;
  hoverExpanded: boolean;
  metricsWidthPx: number;
  visualWidthPx: number;
}): number {
  if (options.collapsed || !options.hoverExpanded) return 0;
  return Math.max(0, options.visualWidthPx - options.metricsWidthPx);
}

/** Apply / clear the hover overlay width on the flyout SVG (metrics untouched). */
export function applyFlyoutVisualOverlay(
  flyoutSvg: SVGElement | null | undefined,
  options: {expanded: boolean; widthPx: number},
): void {
  if (!flyoutSvg) return;
  flyoutSvg.classList.toggle("syncratch-flyout-expanded", options.expanded);
  if (options.expanded) {
    const w = String(Math.max(DEFAULT_FLYOUT_WIDTH_PX, options.widthPx));
    flyoutSvg.setAttribute("width", w);
    flyoutSvg.style.width = `${w}px`;
    flyoutSvg.style.overflow = "visible";
    // Blockly background / clip often live on the first rect / clipPath.
    const bg = flyoutSvg.querySelector<SVGRectElement>("rect.blocklyFlyoutBackground");
    if (bg) bg.setAttribute("width", w);
    for (const clip of flyoutSvg.querySelectorAll("clipPath rect, .blocklyFlyoutClip")) {
      if (clip instanceof SVGRectElement) clip.setAttribute("width", w);
    }
  } else {
    flyoutSvg.style.width = "";
    flyoutSvg.style.overflow = "";
    // Let Blockly position() restore the default width attribute next layout.
  }
}

function resolveFlyout(workspace: WorkspaceWithFlyout | null): FlyoutLike | null {
  const flyout = workspace?.getFlyout?.();
  return flyout && typeof flyout.getWidth === "function" ? flyout : null;
}

function findBlocksHost(root: ParentNode): HTMLElement | null {
  return (
    root.querySelector<HTMLElement>('[class*="blocks_blocks"]') ??
    root.querySelector<HTMLElement>(".injectionDiv")?.parentElement ??
    null
  );
}

function findFlyoutSvg(root: ParentNode): SVGElement | null {
  return root.querySelector<SVGElement>("svg.blocklyFlyout");
}

function findToolboxDiv(root: ParentNode): HTMLElement | null {
  return root.querySelector<HTMLElement>(".blocklyToolboxDiv");
}

function isFlyoutHoverTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest("svg.blocklyFlyout") ||
      target.closest(".blocklyFlyoutScrollbar") ||
      // Toggle rides the visual edge; keep expand while aiming for it.
      target.closest(".syncratch-flyout-toggle"),
  );
}

/**
 * Install collapse toggle + hover-expand on the Scratch continuous flyout.
 * Retries until the workspace/flyout exist (GUI inject is async after mount).
 */
export function installFlyoutLayout(options: {
  root: HTMLElement;
  getWorkspace: () => WorkspaceWithFlyout | null;
  documentRef?: Document;
}): FlyoutLayoutController {
  const documentRef = options.documentRef ?? document;
  let collapsed = false;
  let hoverExpanded = false;
  let contentWidthPx = DEFAULT_FLYOUT_WIDTH_PX;
  let patchedFlyout: FlyoutLike | null = null;
  let originalGetWidth: (() => number) | null = null;
  let disposed = false;
  let attachTimer: ReturnType<typeof setTimeout> | null = null;
  let toolboxEl: HTMLElement | null = null;
  let lastMetricsWidth = DEFAULT_FLYOUT_WIDTH_PX;

  let host: HTMLElement =
    findBlocksHost(options.root) ??
    options.root.querySelector<HTMLElement>(".injectionDiv") ??
    options.root;

  host.classList.add("syncratch-flyout-host");

  const toggle = documentRef.createElement("button");
  toggle.type = "button";
  toggle.className = "syncratch-flyout-toggle";
  toggle.dataset.testid = "flyout-collapse-toggle";
  toggle.setAttribute("aria-controls", "syncratch-block-flyout");
  documentRef.body.append(toggle);

  function ensureHost(): void {
    const next =
      findBlocksHost(options.root) ??
      options.root.querySelector<HTMLElement>(".injectionDiv")?.parentElement ??
      host;
    if (next === host) return;
    host.classList.remove(
      "syncratch-flyout-host",
      "syncratch-flyout-collapsed",
      "syncratch-flyout-hover-expanded",
    );
    host.style.removeProperty("--syncratch-toolbox-width");
    host.style.removeProperty("--syncratch-flyout-width");
    host.style.removeProperty("--syncratch-flyout-scroll-nudge");
    host = next;
    host.classList.add("syncratch-flyout-host");
  }

  function syncToggleUi(): void {
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggle.setAttribute(
      "aria-label",
      collapsed ? "ブロックリストを開く" : "ブロックリストを閉じる",
    );
    toggle.title = collapsed
      ? "ブロックリストを開く"
      : "ブロックリストを閉じる";
    toggle.classList.toggle("is-collapsed", collapsed);
    host.classList.toggle("syncratch-flyout-collapsed", collapsed);
    host.classList.toggle("syncratch-flyout-hover-expanded", hoverExpanded);
  }

  /**
   * @param reflow When true, ask Blockly to rebuild flyout contents/geometry.
   *   Must stay false for MutationObserver-driven updates: reflow mutates the
   *   flyout DOM, which re-triggers the observer and also breaks flyout button
   *   clicks (Create Variable / List / Block) mid pointerdown→pointerup.
   */
  function applyWidth(reflow = true): void {
    const workspace = options.getWorkspace();
    const flyout = resolveFlyout(workspace);
    if (!flyout) return;
    ensureHost();

    const metricsWidth = computeMetricsFlyoutWidth({collapsed});
    const visualWidth = computeVisualFlyoutWidth({
      collapsed,
      hoverExpanded,
      contentWidthPx,
    });

    if (patchedFlyout !== flyout) {
      if (patchedFlyout && originalGetWidth) {
        patchedFlyout.getWidth = originalGetWidth;
      }
      originalGetWidth =
        flyout.getWidth?.bind(flyout) ?? (() => DEFAULT_FLYOUT_WIDTH_PX);
      patchedFlyout = flyout;
      // Metrics width only — never the hover-expanded visual width.
      flyout.getWidth = () => computeMetricsFlyoutWidth({collapsed});
    }

    if (typeof flyout.setVisible === "function") {
      const wantVisible = !collapsed;
      if (flyout.isVisible?.() !== wantVisible) {
        flyout.setVisible(wantVisible);
      }
    }

    const metricsChanged = metricsWidth !== lastMetricsWidth;
    lastMetricsWidth = metricsWidth;

    if (reflow) {
      try {
        // Reflow/position only on intentional layout changes. Hover overlay
        // must not call workspace.resize().
        flyout.reflow?.();
        flyout.position?.();
        if (metricsChanged) {
          workspace?.resize?.();
        }
      } catch {
        // Blockly may throw during teardown / mid-gesture.
      }
    }

    const flyoutSvg = findFlyoutSvg(options.root);
    if (flyoutSvg) flyoutSvg.id = "syncratch-block-flyout";
    applyFlyoutVisualOverlay(flyoutSvg, {
      expanded: hoverExpanded && !collapsed,
      widthPx: visualWidth,
    });

    const toolbox = findToolboxDiv(options.root);
    if (toolbox && toolbox !== toolboxEl) {
      toolboxEl?.removeEventListener("click", onCategoryClick);
      toolboxEl = toolbox;
      toolboxEl.addEventListener("click", onCategoryClick);
    }
    const toolboxWidth = toolbox?.getBoundingClientRect().width ?? 60;
    host.style.setProperty("--syncratch-toolbox-width", `${toolboxWidth}px`);
    host.style.setProperty("--syncratch-flyout-width", `${visualWidth}px`);
    host.style.setProperty(
      "--syncratch-flyout-scroll-nudge",
      `${computeFlyoutScrollbarNudgePx({
        collapsed,
        hoverExpanded,
        metricsWidthPx: metricsWidth,
        visualWidthPx: visualWidth,
      })}px`,
    );

    const toolboxRect = toolbox?.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const hostVisible =
      hostRect.width > 40 &&
      hostRect.height > 40 &&
      getComputedStyle(host).visibility !== "hidden" &&
      getComputedStyle(host).display !== "none";
    toggle.hidden = !hostVisible;
    if (!hostVisible) {
      syncToggleUi();
      return;
    }

    const toolboxRight = toolboxRect?.right ?? hostRect.left + toolboxWidth;
    const edgeX = computeToggleEdgeX({
      collapsed,
      toolboxRightPx: toolboxRight,
      visualFlyoutWidthPx: visualWidth,
    });
    const columnTop = toolboxRect?.top ?? hostRect.top;
    const columnHeight = toolboxRect?.height ?? hostRect.height;
    const midY =
      columnTop + Math.min(Math.max(columnHeight * 0.4, 120), 360) - 36;
    toggle.style.left = `${Math.round(edgeX)}px`;
    toggle.style.top = `${Math.round(midY)}px`;
    if (!toggle.isConnected) documentRef.body.append(toggle);
    syncToggleUi();
  }

  function refreshContentWidth(): void {
    const flyout = resolveFlyout(options.getWorkspace());
    if (!flyout || collapsed) return;
    contentWidthPx = measureFlyoutContentWidthPx(
      flyout,
      findFlyoutSvg(options.root),
    );
  }

  function setCollapsed(next: boolean): void {
    if (collapsed === next) {
      applyWidth();
      return;
    }
    collapsed = next;
    if (collapsed) hoverExpanded = false;
    applyWidth();
  }

  function setHoverExpanded(next: boolean): void {
    if (collapsed) {
      hoverExpanded = false;
      applyWidth(false);
      return;
    }
    if (next) refreshContentWidth();
    if (hoverExpanded === next) return;
    hoverExpanded = next;
    // Hover widen is a visual overlay only — reflow rebuilds flyout DOM and
    // breaks category scroll + block drag/clicks (Scratch shows wrong blocks).
    applyWidth(false);
  }

  let ignoreClickUntil = 0;
  let leaveTimer: ReturnType<typeof setTimeout> | null = null;
  /** True while a pointer is down inside the flyout — skip layout churn. */
  let flyoutPointerActive = false;

  function clearLeaveTimer(): void {
    if (leaveTimer) {
      clearTimeout(leaveTimer);
      leaveTimer = null;
    }
  }

  function onTogglePointerDown(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    ignoreClickUntil = Date.now() + 400;
    hoverExpanded = false;
    setCollapsed(!collapsed);
  }

  function onToggleClick(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    if (Date.now() < ignoreClickUntil) return;
    hoverExpanded = false;
    setCollapsed(!collapsed);
  }

  function onHoverLeave(): void {
    const workspace = options.getWorkspace();
    if (workspace?.isDragging?.()) return;
    setHoverExpanded(false);
  }

  function scheduleHoverLeave(): void {
    clearLeaveTimer();
    leaveTimer = setTimeout(() => {
      leaveTimer = null;
      onHoverLeave();
    }, 80);
  }

  function onCategoryClick(): void {
    if (collapsed) setCollapsed(false);
  }

  const onRootPointerOver = (event: PointerEvent) => {
    if (collapsed) return;
    if (isFlyoutHoverTarget(event.target)) {
      clearLeaveTimer();
      setHoverExpanded(true);
    }
  };

  const onRootPointerOut = (event: PointerEvent) => {
    if (isFlyoutHoverTarget(event.relatedTarget)) return;
    scheduleHoverLeave();
  };

  const onRootPointerDownCapture = (event: PointerEvent) => {
    if (isFlyoutHoverTarget(event.target)) {
      flyoutPointerActive = true;
    }
  };

  const onGlobalPointerUp = () => {
    flyoutPointerActive = false;
  };

  toggle.addEventListener("pointerdown", onTogglePointerDown, true);
  toggle.addEventListener("click", onToggleClick);
  options.root.addEventListener("pointerover", onRootPointerOver);
  options.root.addEventListener("pointerout", onRootPointerOut);
  options.root.addEventListener("pointerdown", onRootPointerDownCapture, true);
  window.addEventListener("pointerup", onGlobalPointerUp, true);
  window.addEventListener("pointercancel", onGlobalPointerUp, true);

  let chromeSyncScheduled = false;
  /**
   * MutationObserver-driven updates: reposition the collapse toggle / overlay
   * only. Never reflow — that rebuilds flyout buttons and cancels clicks.
   */
  const scheduleChromeSync = () => {
    if (disposed || chromeSyncScheduled || flyoutPointerActive) return;
    chromeSyncScheduled = true;
    requestAnimationFrame(() => {
      chromeSyncScheduled = false;
      if (disposed || flyoutPointerActive) return;
      const flyout = resolveFlyout(options.getWorkspace());
      if (!flyout) return;
      applyWidth(false);
    });
  };

  const observer = new MutationObserver(() => scheduleChromeSync());
  observer.observe(options.root, {childList: true, subtree: true});

  const onResize = () => applyWidth(true);
  window.addEventListener("resize", onResize);

  const tryAttach = () => {
    if (disposed) return;
    const flyout = resolveFlyout(options.getWorkspace());
    if (!flyout) {
      attachTimer = setTimeout(tryAttach, 200);
      return;
    }
    refreshContentWidth();
    applyWidth();
  };
  tryAttach();
  syncToggleUi();

  return {
    isCollapsed: () => collapsed,
    setCollapsed,
    toggleCollapsed: () => setCollapsed(!collapsed),
    isHoverExpanded: () => hoverExpanded,
    dispose: () => {
      disposed = true;
      if (attachTimer) clearTimeout(attachTimer);
      clearLeaveTimer();
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointerup", onGlobalPointerUp, true);
      window.removeEventListener("pointercancel", onGlobalPointerUp, true);
      options.root.removeEventListener("pointerover", onRootPointerOver);
      options.root.removeEventListener("pointerout", onRootPointerOut);
      options.root.removeEventListener(
        "pointerdown",
        onRootPointerDownCapture,
        true,
      );
      toggle.removeEventListener("pointerdown", onTogglePointerDown, true);
      toggle.removeEventListener("click", onToggleClick);
      toolboxEl?.removeEventListener("click", onCategoryClick);
      if (patchedFlyout && originalGetWidth) {
        patchedFlyout.getWidth = originalGetWidth;
      }
      applyFlyoutVisualOverlay(findFlyoutSvg(options.root), {
        expanded: false,
        widthPx: DEFAULT_FLYOUT_WIDTH_PX,
      });
      toggle.remove();
      host.classList.remove(
        "syncratch-flyout-host",
        "syncratch-flyout-collapsed",
        "syncratch-flyout-hover-expanded",
      );
      host.style.removeProperty("--syncratch-toolbox-width");
      host.style.removeProperty("--syncratch-flyout-width");
      host.style.removeProperty("--syncratch-flyout-scroll-nudge");
    },
  };
}
