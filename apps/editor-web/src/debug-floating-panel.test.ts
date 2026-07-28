import {describe, expect, it} from "vitest";
import {
  defaultDebugPanelPosition,
  installDebugFloatingPanel,
} from "./debug-floating-panel.js";

describe("defaultDebugPanelPosition", () => {
  it("anchors toward the lower-right so the stage stays visible", () => {
    expect(
      defaultDebugPanelPosition({
        width: 360,
        viewportWidth: 1280,
        viewportHeight: 800,
      }),
    ).toEqual({left: 904, top: 304});
  });
});

describe("installDebugFloatingPanel", () => {
  it("portals the panel, toggles visibility, and closes from the button", () => {
    const hostChildren: HTMLElement[] = [];
    let panelParent: HTMLElement | null = null;
    const portalHost = {
      appendChild(node: HTMLElement) {
        hostChildren.push(node);
        panelParent = portalHost as unknown as HTMLElement;
        return node;
      },
    } as unknown as HTMLElement;

    const panelStyle: Record<string, string> = {};
    const panelClass = new Set<string>();
    const panelAttrs = new Map<string, string>();
    let panelHidden = true;

    const panel = {
      style: panelStyle,
      get parentElement() {
        return panelParent;
      },
      classList: {
        add: (name: string) => {
          panelClass.add(name);
        },
        remove: (name: string) => {
          panelClass.delete(name);
        },
        toggle: (name: string, force?: boolean) => {
          const next = force ?? !panelClass.has(name);
          if (next) panelClass.add(name);
          else panelClass.delete(name);
        },
        contains: (name: string) => panelClass.has(name),
      },
      setAttribute(name: string, value: string) {
        panelAttrs.set(name, value);
      },
      get hidden() {
        return panelHidden;
      },
      set hidden(value: boolean) {
        panelHidden = value;
      },
      getBoundingClientRect: () => ({
        left: 100,
        top: 120,
        width: 360,
        height: 320,
        right: 460,
        bottom: 440,
        x: 100,
        y: 120,
        toJSON: () => ({}),
      }),
    } as unknown as HTMLElement;

    const handleListeners = new Map<string, Set<(event: Event) => void>>();
    const handle = {
      addEventListener(type: string, listener: (event: Event) => void) {
        if (!handleListeners.has(type)) handleListeners.set(type, new Set());
        handleListeners.get(type)!.add(listener);
      },
      removeEventListener(type: string, listener: (event: Event) => void) {
        handleListeners.get(type)?.delete(listener);
      },
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
      hasPointerCapture: () => false,
    } as unknown as HTMLElement;

    const closeListeners = new Set<() => void>();
    const closeButton = {
      addEventListener(_type: string, listener: () => void) {
        closeListeners.add(listener);
      },
      removeEventListener(_type: string, listener: () => void) {
        closeListeners.delete(listener);
      },
    } as unknown as HTMLButtonElement;

    const viewport = {
      innerWidth: 1280,
      innerHeight: 800,
      addEventListener: () => {},
      removeEventListener: () => {},
    };

    const controller = installDebugFloatingPanel({
      panel,
      handle,
      closeButton,
      portalHost,
      viewport,
    });

    expect(controller.isOpen()).toBe(false);
    expect(panelClass.has("debug-floating-panel")).toBe(true);
    expect(panelAttrs.get("role")).toBe("dialog");

    controller.setOpen(true);
    expect(controller.isOpen()).toBe(true);
    expect(hostChildren).toHaveLength(1);
    expect(panelHidden).toBe(false);
    expect(panelClass.has("is-open")).toBe(true);
    expect(panelStyle.left).toBeTruthy();

    for (const listener of closeListeners) listener();
    expect(controller.isOpen()).toBe(false);
    expect(panelHidden).toBe(true);

    controller.dispose();
  });
});
