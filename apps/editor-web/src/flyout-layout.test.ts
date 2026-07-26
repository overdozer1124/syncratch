/** @vitest-environment jsdom */
import {describe, expect, it, vi} from "vitest";
import {
  clampFlyoutWidth,
  computeFlyoutDisplayWidth,
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

  it("computeFlyoutDisplayWidth collapses to 0", () => {
    expect(
      computeFlyoutDisplayWidth({
        collapsed: true,
        hoverExpanded: true,
        contentWidthPx: 400,
      }),
    ).toBe(0);
  });

  it("computeFlyoutDisplayWidth uses default until hover-expanded", () => {
    expect(
      computeFlyoutDisplayWidth({
        collapsed: false,
        hoverExpanded: false,
        contentWidthPx: 400,
      }),
    ).toBe(DEFAULT_FLYOUT_WIDTH_PX);
    expect(
      computeFlyoutDisplayWidth({
        collapsed: false,
        hoverExpanded: true,
        contentWidthPx: 400,
      }),
    ).toBe(400);
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
    // 600 * 0.5 + padding 28 = 328
    expect(measureFlyoutContentWidthPx(flyout)).toBe(328);
  });

  it("measureFlyoutContentWidthPx falls back to default when empty", () => {
    const flyout: FlyoutLike = {
      getFlyoutScale: () => 0.675,
      getWorkspace: () => ({getAllBlocks: () => []}),
    };
    expect(measureFlyoutContentWidthPx(flyout)).toBe(DEFAULT_FLYOUT_WIDTH_PX);
  });
});

describe("installFlyoutLayout", () => {
  it("patches getWidth and toggles collapse / hover expand", async () => {
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
    const toolbox = document.createElement("div");
    toolbox.className = "blocklyToolboxDiv";
    Object.defineProperty(toolbox, "getBoundingClientRect", {
      value: () => ({width: 60, left: 0, right: 60, top: 0, bottom: 100}),
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

    // Allow tryAttach timeout path / sync
    await new Promise(r => setTimeout(r, 0));

    expect(flyout.getWidth?.()).toBe(DEFAULT_FLYOUT_WIDTH_PX);

    const toggle = document.querySelector<HTMLButtonElement>(
      '[data-testid="flyout-collapse-toggle"]',
    );
    expect(toggle).toBeTruthy();
    toggle?.click();
    expect(controller.isCollapsed()).toBe(true);
    expect(flyout.getWidth?.()).toBe(0);
    expect(flyout.setVisible).toHaveBeenCalledWith(false);

    toggle?.click();
    expect(controller.isCollapsed()).toBe(false);

    const over = new PointerEvent("pointerover", {bubbles: true});
    Object.defineProperty(over, "target", {value: flyoutSvg});
    root.dispatchEvent(over);
    expect(controller.isHoverExpanded()).toBe(true);
    expect(flyout.getWidth?.()).toBeGreaterThan(DEFAULT_FLYOUT_WIDTH_PX);

    const out = new PointerEvent("pointerout", {bubbles: true});
    Object.defineProperty(out, "relatedTarget", {value: document.body});
    root.dispatchEvent(out);
    expect(controller.isHoverExpanded()).toBe(false);

    controller.dispose();
    expect(
      document.querySelector('[data-testid="flyout-collapse-toggle"]'),
    ).toBe(null);
    root.remove();
  });
});
