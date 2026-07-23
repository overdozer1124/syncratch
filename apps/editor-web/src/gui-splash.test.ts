import {describe, expect, it, vi} from "vitest";
import {setGuiSplashProgress, setGuiSplashVisible} from "./gui-splash.js";

describe("setGuiSplashVisible", () => {
  it("toggles hidden and aria-busy", () => {
    const splash = {
      toggleAttribute: vi.fn(),
      setAttribute: vi.fn(),
    } as unknown as HTMLElement;

    setGuiSplashVisible(splash, true);
    expect(splash.toggleAttribute).toHaveBeenCalledWith("hidden", false);
    expect(splash.setAttribute).toHaveBeenCalledWith("aria-busy", "true");

    setGuiSplashVisible(splash, false);
    expect(splash.toggleAttribute).toHaveBeenCalledWith("hidden", true);
    expect(splash.setAttribute).toHaveBeenCalledWith("aria-busy", "false");
  });

  it("no-ops when splash is missing", () => {
    expect(() => setGuiSplashVisible(null, true)).not.toThrow();
  });
});

describe("setGuiSplashProgress", () => {
  it("updates bar width, meter value, and status label", () => {
    const bar = {style: {setProperty: vi.fn()}};
    const meter = {setAttribute: vi.fn()};
    const status = {textContent: ""};
    const splash = {
      querySelector: vi.fn((selector: string) => {
        if (selector === "[data-splash-progress-bar]") return bar;
        if (selector === "[data-splash-progress]") return meter;
        if (selector === "[data-splash-status]") return status;
        return null;
      }),
    } as unknown as HTMLElement;

    setGuiSplashProgress(splash, {
      ratio: 0.62,
      label: "Scratch エディターを読み込んでいます…",
    });

    expect(bar.style.setProperty).toHaveBeenCalledWith("--progress", "62%");
    expect(meter.setAttribute).toHaveBeenCalledWith("aria-valuenow", "62");
    expect(status.textContent).toBe("Scratch エディターを読み込んでいます…");
  });

  it("clamps progress into 0–100", () => {
    const bar = {style: {setProperty: vi.fn()}};
    const meter = {setAttribute: vi.fn()};
    const splash = {
      querySelector: vi.fn((selector: string) => {
        if (selector === "[data-splash-progress-bar]") return bar;
        if (selector === "[data-splash-progress]") return meter;
        return null;
      }),
    } as unknown as HTMLElement;

    setGuiSplashProgress(splash, {ratio: 1.4, label: "done"});
    expect(bar.style.setProperty).toHaveBeenCalledWith("--progress", "100%");
    expect(meter.setAttribute).toHaveBeenCalledWith("aria-valuenow", "100");

    setGuiSplashProgress(splash, {ratio: -0.2, label: "start"});
    expect(bar.style.setProperty).toHaveBeenCalledWith("--progress", "0%");
    expect(meter.setAttribute).toHaveBeenCalledWith("aria-valuenow", "0");
  });
});
