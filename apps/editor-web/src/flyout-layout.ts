/**
 * Syncratch flyout (ブロックリスト) layout controls:
 * 1. Collapse / expand the continuous flyout while keeping the category rail
 * 2. Temporarily widen the flyout on hover so clipped long blocks are visible
 *
 * Scratch Blocks hard-codes CheckableContinuousFlyout.getWidth() = 250. Metrics
 * (ContinuousMetrics) read that value, so width changes must go through getWidth
 * + workspace.resize() — CSS-only widening desyncs the workspace origin.
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

export function computeFlyoutDisplayWidth(options: {
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

function isFlyoutPointerTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest("svg.blocklyFlyout") ||
      target.closest(".blocklyFlyoutScrollbar") ||
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
  // Mount on body so fixed positioning is never clipped by Blockly overflow.
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

  function applyWidth(): void {
    const workspace = options.getWorkspace();
    const flyout = resolveFlyout(workspace);
    if (!flyout) return;
    ensureHost();

    if (patchedFlyout !== flyout) {
      if (patchedFlyout && originalGetWidth) {
        patchedFlyout.getWidth = originalGetWidth;
      }
      originalGetWidth =
        flyout.getWidth?.bind(flyout) ?? (() => DEFAULT_FLYOUT_WIDTH_PX);
      patchedFlyout = flyout;
      flyout.getWidth = () =>
        computeFlyoutDisplayWidth({
          collapsed,
          hoverExpanded,
          contentWidthPx,
        });
    }

    if (typeof flyout.setVisible === "function") {
      const wantVisible = !collapsed;
      if (flyout.isVisible?.() !== wantVisible) {
        flyout.setVisible(wantVisible);
      }
    }

    try {
      flyout.reflow?.();
      flyout.position?.();
      workspace?.resize?.();
    } catch {
      // Blockly may throw during teardown / mid-gesture.
    }

    const flyoutSvg = findFlyoutSvg(options.root);
    if (flyoutSvg) {
      flyoutSvg.id = "syncratch-block-flyout";
      flyoutSvg.classList.toggle("syncratch-flyout-expanded", hoverExpanded);
    }

    const toolbox = findToolboxDiv(options.root);
    if (toolbox && toolbox !== toolboxEl) {
      toolboxEl?.removeEventListener("click", onCategoryClick);
      toolboxEl = toolbox;
      toolboxEl.addEventListener("click", onCategoryClick);
    }
    const toolboxWidth = toolbox?.getBoundingClientRect().width ?? 60;
    const displayWidth = computeFlyoutDisplayWidth({
      collapsed,
      hoverExpanded,
      contentWidthPx,
    });
    host.style.setProperty("--syncratch-toolbox-width", `${toolboxWidth}px`);
    host.style.setProperty("--syncratch-flyout-width", `${displayWidth}px`);

    // Fixed positioning avoids Blockly stacking contexts stealing clicks.
    const toolboxRect = toolbox?.getBoundingClientRect();
    const flyoutRect = flyoutSvg?.getBoundingClientRect();
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

    const edgeX = collapsed
      ? (toolboxRect?.right ?? hostRect.left + toolboxWidth)
      : (flyoutRect?.right ??
        hostRect.left + toolboxWidth + displayWidth);
    // Vertical center against the blocks pane, not the toolbox chrome alone.
    const midY = hostRect.top + hostRect.height / 2 - 32;
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
      applyWidth();
      return;
    }
    if (next) refreshContentWidth();
    if (hoverExpanded === next) return;
    hoverExpanded = next;
    applyWidth();
  }

  function onToggleClick(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    setCollapsed(!collapsed);
  }

  function onHoverLeave(): void {
    const workspace = options.getWorkspace();
    if (workspace?.isDragging?.()) return;
    setHoverExpanded(false);
  }

  function onCategoryClick(): void {
    if (collapsed) setCollapsed(false);
  }

  const onRootPointerOver = (event: PointerEvent) => {
    if (collapsed) return;
    if (isFlyoutPointerTarget(event.target)) {
      setHoverExpanded(true);
    }
  };

  const onRootPointerOut = (event: PointerEvent) => {
    if (isFlyoutPointerTarget(event.relatedTarget)) return;
    onHoverLeave();
  };

  toggle.addEventListener("click", onToggleClick);
  options.root.addEventListener("pointerover", onRootPointerOver);
  options.root.addEventListener("pointerout", onRootPointerOut);

  let applyScheduled = false;
  const scheduleApply = () => {
    if (disposed || applyScheduled) return;
    applyScheduled = true;
    requestAnimationFrame(() => {
      applyScheduled = false;
      if (disposed) return;
      const flyout = resolveFlyout(options.getWorkspace());
      if (!flyout) return;
      // Re-bind if Blockly replaced the flyout instance; keep toggle aligned.
      applyWidth();
    });
  };

  const observer = new MutationObserver(() => scheduleApply());
  observer.observe(options.root, {childList: true, subtree: true});

  const onResize = () => applyWidth();
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
      observer.disconnect();
      window.removeEventListener("resize", onResize);
      options.root.removeEventListener("pointerover", onRootPointerOver);
      options.root.removeEventListener("pointerout", onRootPointerOut);
      toggle.removeEventListener("click", onToggleClick);
      toolboxEl?.removeEventListener("click", onCategoryClick);
      if (patchedFlyout && originalGetWidth) {
        patchedFlyout.getWidth = originalGetWidth;
      }
      toggle.remove();
      host.classList.remove(
        "syncratch-flyout-host",
        "syncratch-flyout-collapsed",
        "syncratch-flyout-hover-expanded",
      );
      host.style.removeProperty("--syncratch-toolbox-width");
      host.style.removeProperty("--syncratch-flyout-width");
    },
  };
}
