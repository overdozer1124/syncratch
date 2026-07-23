import {describe, expect, it} from "vitest";
import {
  clampAiPanelPosition,
  defaultAiPanelPosition,
  installAiFloatingPanel,
} from "./ai-floating-panel.js";

describe("ai floating panel geometry", () => {
  it("clamps the panel inside the viewport", () => {
    expect(
      clampAiPanelPosition({
        left: -40,
        top: -10,
        width: 320,
        height: 240,
        viewportWidth: 1000,
        viewportHeight: 800,
      }),
    ).toEqual({left: 8, top: 8});

    expect(
      clampAiPanelPosition({
        left: 900,
        top: 700,
        width: 320,
        height: 240,
        viewportWidth: 1000,
        viewportHeight: 800,
      }),
    ).toEqual({left: 672, top: 552});
  });

  it("defaults to the top-right under the toolbar", () => {
    expect(
      defaultAiPanelPosition({
        width: 500,
        viewportWidth: 1200,
      }),
    ).toEqual({left: 688, top: 72});
  });
});

describe("installAiFloatingPanel", () => {
  it("portals open dialog content, applies drag deltas, and closes from the button", () => {
    const on = (
      map: Map<string, Set<(event: Event) => void>>,
      type: string,
      handler: (event: Event) => void,
    ) => {
      if (!map.has(type)) map.set(type, new Set());
      map.get(type)!.add(handler);
    };
    const emit = (
      map: Map<string, Set<(event: Event) => void>>,
      type: string,
      event: Event,
    ) => {
      for (const handler of map.get(type) ?? []) handler(event);
    };

    const hostChildren: HTMLElement[] = [];
    let contentParent: HTMLElement | null = null;
    const portalHost = {
      appendChild(node: HTMLElement) {
        hostChildren.push(node);
        contentParent = portalHost as unknown as HTMLElement;
        return node;
      },
    } as unknown as HTMLElement;

    const contentStyle: Record<string, string> = {};
    const contentClass = new Set<string>();
    const contentAttrs = new Map<string, string>();
    let contentHidden = true;

    const content = {
      style: contentStyle,
      get parentElement() {
        return contentParent;
      },
      get hidden() {
        return contentHidden;
      },
      set hidden(value: boolean) {
        contentHidden = Boolean(value);
      },
      classList: {
        add: (name: string) => {
          contentClass.add(name);
        },
        remove: (name: string) => {
          contentClass.delete(name);
        },
        toggle: (name: string, force?: boolean) => {
          const enabled = force ?? !contentClass.has(name);
          if (enabled) contentClass.add(name);
          else contentClass.delete(name);
          return enabled;
        },
        contains: (name: string) => contentClass.has(name),
      },
      setAttribute: (name: string, value: string) => {
        contentAttrs.set(name, value);
      },
      getBoundingClientRect: () =>
        ({
          left: Number.parseFloat(contentStyle.left || "100") || 100,
          top: Number.parseFloat(contentStyle.top || "80") || 80,
          width: 300,
          height: 200,
          right: 400,
          bottom: 280,
          x: 100,
          y: 80,
          toJSON: () => ({}),
        }) as DOMRect,
    } as unknown as HTMLElement;

    let panelOpen = false;
    const panelListeners = new Map<string, Set<(event: Event) => void>>();
    const panel = {
      get open() {
        return panelOpen;
      },
      set open(value: boolean) {
        panelOpen = value;
      },
      hidden: false,
      addEventListener: (type: string, handler: (event: Event) => void) => {
        on(panelListeners, type, handler);
      },
      removeEventListener: (type: string, handler: (event: Event) => void) => {
        panelListeners.get(type)?.delete(handler);
      },
    } as unknown as HTMLDetailsElement;

    const handleListeners = new Map<string, Set<(event: Event) => void>>();
    const captured = new Set<number>();
    const handle = {
      addEventListener: (type: string, handler: (event: Event) => void) => {
        on(handleListeners, type, handler);
      },
      removeEventListener: (type: string, handler: (event: Event) => void) => {
        handleListeners.get(type)?.delete(handler);
      },
      setPointerCapture: (id: number) => {
        captured.add(id);
      },
      releasePointerCapture: (id: number) => {
        captured.delete(id);
      },
      hasPointerCapture: (id: number) => captured.has(id),
    } as unknown as HTMLElement;

    const closeListeners = new Map<string, Set<(event: Event) => void>>();
    const closeButton = {
      addEventListener: (type: string, handler: (event: Event) => void) => {
        on(closeListeners, type, handler);
      },
      removeEventListener: (type: string, handler: (event: Event) => void) => {
        closeListeners.get(type)?.delete(handler);
      },
    } as unknown as HTMLButtonElement;

    const viewportListeners = new Map<string, Set<(event: Event) => void>>();
    const viewport = {
      innerWidth: 1200,
      innerHeight: 800,
      addEventListener: (type: string, handler: (event: Event) => void) => {
        on(viewportListeners, type, handler);
      },
      removeEventListener: (type: string, handler: (event: Event) => void) => {
        viewportListeners.get(type)?.delete(handler);
      },
    };

    const dispose = installAiFloatingPanel({
      panel,
      content,
      handle,
      closeButton,
      portalHost,
      viewport,
    });

    expect(contentClass.has("ai-floating-panel")).toBe(true);
    expect(contentAttrs.get("role")).toBe("dialog");
    expect(contentAttrs.get("aria-modal")).toBe("false");
    expect(contentHidden).toBe(true);

    panelOpen = true;
    emit(panelListeners, "toggle", {type: "toggle"} as Event);

    expect(hostChildren).toContain(content);
    expect(contentHidden).toBe(false);
    expect(contentClass.has("is-open")).toBe(true);
    // Mock content width is 300 → left = 1200 - 300 - 12.
    expect(contentStyle.left).toBe("888px");
    expect(contentStyle.top).toBe("72px");

    contentStyle.left = "100px";
    contentStyle.top = "80px";

    emit(handleListeners, "pointerdown", {
      type: "pointerdown",
      button: 0,
      clientX: 120,
      clientY: 90,
      pointerId: 1,
      target: handle,
      preventDefault() {},
    } as unknown as Event);
    emit(handleListeners, "pointermove", {
      type: "pointermove",
      clientX: 160,
      clientY: 130,
      pointerId: 1,
    } as unknown as Event);
    emit(handleListeners, "pointerup", {
      type: "pointerup",
      pointerId: 1,
    } as unknown as Event);

    expect(contentStyle.left).toBe("140px");
    expect(contentStyle.top).toBe("120px");

    emit(closeListeners, "click", {type: "click"} as Event);
    expect(panelOpen).toBe(false);

    dispose();
    expect(viewportListeners.get("resize")?.size ?? 0).toBe(0);
  });
});
