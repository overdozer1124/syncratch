/** @vitest-environment jsdom */
import {describe, expect, it, vi} from "vitest";
import {
  applyFlyoutVisualOverlay,
  clampFlyoutWidth,
  computeMetricsFlyoutWidth,
  computeFlyoutScrollbarNudgePx,
  computeToggleEdgeX,
  computeVisualFlyoutWidth,
  DEFAULT_FLYOUT_WIDTH_PX,
  MAX_FLYOUT_WIDTH_PX,
  measureFlyoutContentWidthPx,
  type FlyoutLike,
} from "./flyout-layout.js";

describe("flyout layout helpers", () => {
  it("clamps flyout width between default and max", () => {
    expect(clampFlyoutWidth(100)).toBe(DEFAULT_FLYOUT_WIDTH_PX);
    expect(clampFlyoutWidth(300)).toBe(300);
    expect(clampFlyoutWidth(9999)).toBe(MAX_FLYOUT_WIDTH_PX);
    expect(clampFlyoutWidth(Number.NaN)).toBe(DEFAULT_FLYOUT_WIDTH_PX);
  });

  it("metrics width ignores hover-expand so workspace origin stays put", () => {
    expect(computeMetricsFlyoutWidth({collapsed: true})).toBe(0);
    expect(computeMetricsFlyoutWidth({collapsed: false})).toBe(
      DEFAULT_FLYOUT_WIDTH_PX,
    );
  });

  it("visual width grows on hover-expand", () => {
    expect(
      computeVisualFlyoutWidth({
        collapsed: false,
        hoverExpanded: false,
        contentWidthPx: 400,
      }),
    ).toBe(DEFAULT_FLYOUT_WIDTH_PX);
    expect(
      computeVisualFlyoutWidth({
        collapsed: false,
        hoverExpanded: true,
        contentWidthPx: 400,
      }),
    ).toBe(400);
    expect(
      computeVisualFlyoutWidth({
        collapsed: true,
        hoverExpanded: true,
        contentWidthPx: 400,
      }),
    ).toBe(0);
  });

  it("measureFlyoutContentWidthPx uses block geometry and scale", () => {
    const flyout: FlyoutLike = {
      getFlyoutScale: () => 0.5,
      getWorkspace: () => ({
        getAllBlocks: () => [
          {getHeightWidth: () => ({width: 200, height: 40})},
          {getHeightWidth: () => ({width: 600, height: 40})},
        ],
      }),
    };
    expect(measureFlyoutContentWidthPx(flyout)).toBe(328);
  });

  it("computeFlyoutScrollbarNudgePx offsets scrollbar only on hover-expand", () => {
    expect(
      computeFlyoutScrollbarNudgePx({
        collapsed: false,
        hoverExpanded: false,
        metricsWidthPx: DEFAULT_FLYOUT_WIDTH_PX,
        visualWidthPx: 400,
      }),
    ).toBe(0);
    expect(
      computeFlyoutScrollbarNudgePx({
        collapsed: false,
        hoverExpanded: true,
        metricsWidthPx: DEFAULT_FLYOUT_WIDTH_PX,
        visualWidthPx: 400,
      }),
    ).toBe(150);
    expect(
      computeFlyoutScrollbarNudgePx({
        collapsed: true,
        hoverExpanded: true,
        metricsWidthPx: 0,
        visualWidthPx: 400,
      }),
    ).toBe(0);
  });

  it("computeToggleEdgeX follows the visual flyout edge", () => {
    expect(
      computeToggleEdgeX({
        collapsed: false,
        toolboxRightPx: 60,
        visualFlyoutWidthPx: DEFAULT_FLYOUT_WIDTH_PX,
      }),
    ).toBe(60 + DEFAULT_FLYOUT_WIDTH_PX);
    expect(
      computeToggleEdgeX({
        collapsed: false,
        toolboxRightPx: 60,
        visualFlyoutWidthPx: 400,
      }),
    ).toBe(460);
    expect(
      computeToggleEdgeX({
        collapsed: true,
        toolboxRightPx: 60,
        visualFlyoutWidthPx: 400,
      }),
    ).toBe(60);
  });

  it("applyFlyoutVisualOverlay sets svg width without needing metrics", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("blocklyFlyout");
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.classList.add("blocklyFlyoutBackground");
    svg.append(bg);
    applyFlyoutVisualOverlay(svg, {expanded: true, widthPx: 420});
    expect(svg.getAttribute("width")).toBe("420");
    expect(svg.classList.contains("syncratch-flyout-expanded")).toBe(true);
    expect(bg.getAttribute("width")).toBe("420");
    applyFlyoutVisualOverlay(svg, {expanded: false, widthPx: 250});
    expect(svg.classList.contains("syncratch-flyout-expanded")).toBe(false);
  });
});

describe("installFlyoutLayout", () => {
  it("keeps metrics width stable on hover and moves the toggle with visual width", async () => {
    const {installFlyoutLayout} = await import("./flyout-layout.js");

    const flyout: FlyoutLike = {
      getWidth: () => DEFAULT_FLYOUT_WIDTH_PX,
      isVisible: () => true,
      setVisible: vi.fn(function (this: FlyoutLike, visible: boolean) {
        this.isVisible = () => visible;
      }),
      position: vi.fn(),
      reflow: vi.fn(),
      getFlyoutScale: () => 1,
      getWorkspace: () => ({
        getAllBlocks: () => [
          {getHeightWidth: () => ({width: 360, height: 40})},
        ],
      }),
    };
    const workspace = {
      resize: vi.fn(),
      isDragging: () => false,
      getFlyout: () => flyout,
    };

    const root = document.createElement("div");
    const blocks = document.createElement("div");
    blocks.className = "blocks_blocks_test";
    Object.defineProperty(blocks, "getBoundingClientRect", {
      value: () => ({
        width: 800,
        height: 600,
        left: 0,
        right: 800,
        top: 0,
        bottom: 600,
      }),
    });
    const toolbox = document.createElement("div");
    toolbox.className = "blocklyToolboxDiv";
    Object.defineProperty(toolbox, "getBoundingClientRect", {
      value: () => ({width: 60, left: 0, right: 60, top: 0, bottom: 600}),
    });
    const flyoutSvg = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    flyoutSvg.classList.add("blocklyFlyout");
    blocks.append(toolbox, flyoutSvg);
    root.append(blocks);
    document.body.append(root);

    const controller = installFlyoutLayout({
      root,
      getWorkspace: () => workspace,
    });
    await new Promise(r => setTimeout(r, 0));

    expect(flyout.getWidth?.()).toBe(DEFAULT_FLYOUT_WIDTH_PX);
    const resizeCallsAfterAttach = workspace.resize.mock.calls.length;

    const toggle = document.querySelector<HTMLButtonElement>(
      '[data-testid="flyout-collapse-toggle"]',
    );
    expect(toggle).toBeTruthy();
    const leftBeforeHover = toggle!.style.left;

    const over = new PointerEvent("pointerover", {bubbles: true});
    Object.defineProperty(over, "target", {value: flyoutSvg});
    root.dispatchEvent(over);
    expect(controller.isHoverExpanded()).toBe(true);
    // Metrics width unchanged — workspace must not shift.
    expect(flyout.getWidth?.()).toBe(DEFAULT_FLYOUT_WIDTH_PX);
    expect(workspace.resize.mock.calls.length).toBe(resizeCallsAfterAttach);
    expect(flyoutSvg.classList.contains("syncratch-flyout-expanded")).toBe(
      true,
    );
    expect(Number.parseInt(flyoutSvg.getAttribute("width") || "0", 10)).toBeGreaterThan(
      DEFAULT_FLYOUT_WIDTH_PX,
    );
    // Toggle follows the visual (expanded) edge.
    expect(toggle!.style.left).not.toBe(leftBeforeHover);
    expect(Number.parseFloat(toggle!.style.left)).toBeGreaterThan(
      Number.parseFloat(leftBeforeHover || "0"),
    );
    expect(blocks.style.getPropertyValue("--syncratch-flyout-scroll-nudge")).toBe(
      `${388 - DEFAULT_FLYOUT_WIDTH_PX}px`,
    );

    const out = new PointerEvent("pointerout", {bubbles: true});
    Object.defineProperty(out, "relatedTarget", {value: document.body});
    root.dispatchEvent(out);
    await new Promise(r => setTimeout(r, 100));
    expect(controller.isHoverExpanded()).toBe(false);
    expect(flyout.getWidth?.()).toBe(DEFAULT_FLYOUT_WIDTH_PX);
    expect(workspace.resize.mock.calls.length).toBe(resizeCallsAfterAttach);
    expect(toggle!.style.left).toBe(leftBeforeHover);
    expect(blocks.style.getPropertyValue("--syncratch-flyout-scroll-nudge")).toBe(
      "0px",
    );

    toggle?.click();
    expect(controller.isCollapsed()).toBe(true);
    expect(flyout.getWidth?.()).toBe(0);
    expect(flyout.setVisible).toHaveBeenCalledWith(false);

    controller.dispose();
    expect(
      document.querySelector('[data-testid="flyout-collapse-toggle"]'),
    ).toBe(null);
    root.remove();
  });

  it("does not reflow the flyout on MutationObserver churn (keeps Create Variable clicks)", async () => {
    const {installFlyoutLayout} = await import("./flyout-layout.js");

    const flyout: FlyoutLike = {
      getWidth: () => DEFAULT_FLYOUT_WIDTH_PX,
      isVisible: () => true,
      setVisible: vi.fn(),
      position: vi.fn(),
      reflow: vi.fn(),
      getFlyoutScale: () => 1,
      getWorkspace: () => ({
        getAllBlocks: () => [{getHeightWidth: () => ({width: 200, height: 40})}],
      }),
    };
    const workspace = {
      resize: vi.fn(),
      isDragging: () => false,
      getFlyout: () => flyout,
    };

    const root = document.createElement("div");
    const blocks = document.createElement("div");
    blocks.className = "blocks_blocks_test";
    Object.defineProperty(blocks, "getBoundingClientRect", {
      value: () => ({
        width: 800,
        height: 600,
        left: 0,
        right: 800,
        top: 0,
        bottom: 600,
      }),
    });
    const toolbox = document.createElement("div");
    toolbox.className = "blocklyToolboxDiv";
    Object.defineProperty(toolbox, "getBoundingClientRect", {
      value: () => ({width: 60, left: 0, right: 60, top: 0, bottom: 600}),
    });
    const flyoutSvg = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    flyoutSvg.classList.add("blocklyFlyout");
    blocks.append(toolbox, flyoutSvg);
    root.append(blocks);
    document.body.append(root);

    const controller = installFlyoutLayout({
      root,
      getWorkspace: () => workspace,
    });
    await new Promise(r => setTimeout(r, 0));
    const reflow = flyout.reflow as ReturnType<typeof vi.fn>;
    const reflowsAfterAttach = reflow.mock.calls.length;

    // Simulate Scratch GUI DOM churn unrelated to flyout layout.
    for (let i = 0; i < 5; i += 1) {
      const noise = document.createElement("div");
      noise.className = "gui-noise";
      root.append(noise);
    }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise(r => setTimeout(r, 0));

    expect(reflow.mock.calls.length).toBe(reflowsAfterAttach);

    // Intentional collapse still reflows.
    controller.setCollapsed(true);
    expect(reflow.mock.calls.length).toBeGreaterThan(reflowsAfterAttach);

    controller.dispose();
    root.remove();
  });

  it("skips chrome sync while a pointer is down on the flyout", async () => {
    const {installFlyoutLayout} = await import("./flyout-layout.js");

    const flyout: FlyoutLike = {
      getWidth: () => DEFAULT_FLYOUT_WIDTH_PX,
      isVisible: () => true,
      setVisible: vi.fn(),
      position: vi.fn(),
      reflow: vi.fn(),
      getFlyoutScale: () => 1,
      getWorkspace: () => ({getAllBlocks: () => []}),
    };
    const workspace = {
      resize: vi.fn(),
      isDragging: () => false,
      getFlyout: () => flyout,
    };

    const root = document.createElement("div");
    const blocks = document.createElement("div");
    blocks.className = "blocks_blocks_test";
    Object.defineProperty(blocks, "getBoundingClientRect", {
      value: () => ({
        width: 800,
        height: 600,
        left: 0,
        right: 800,
        top: 0,
        bottom: 600,
      }),
    });
    const toolbox = document.createElement("div");
    toolbox.className = "blocklyToolboxDiv";
    Object.defineProperty(toolbox, "getBoundingClientRect", {
      value: () => ({width: 60, left: 0, right: 60, top: 0, bottom: 600}),
    });
    const flyoutSvg = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    flyoutSvg.classList.add("blocklyFlyout");
    const button = document.createElementNS("http://www.w3.org/2000/svg", "g");
    button.classList.add("blocklyFlyoutButton");
    flyoutSvg.append(button);
    blocks.append(toolbox, flyoutSvg);
    root.append(blocks);
    document.body.append(root);

    const controller = installFlyoutLayout({
      root,
      getWorkspace: () => workspace,
    });
    await new Promise(r => setTimeout(r, 0));
    const reflow = flyout.reflow as ReturnType<typeof vi.fn>;
    const before = reflow.mock.calls.length;

    button.dispatchEvent(
      new PointerEvent("pointerdown", {bubbles: true, composed: true}),
    );
    // DOM churn during the click must not reflow (would drop the button).
    root.append(document.createElement("div"));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    expect(reflow.mock.calls.length).toBe(before);

    window.dispatchEvent(new PointerEvent("pointerup", {bubbles: true}));
    controller.dispose();
    root.remove();
  });
});
