import {describe, expect, it, vi} from "vitest";
import {
  createEphemeralToast,
  EPHEMERAL_TOAST_DEFAULT_MS,
} from "./ephemeral-toast.js";

function mockToastRoot(): HTMLElement {
  const classes = new Set<string>();
  return {
    hidden: true,
    textContent: "",
    classList: {
      add(name: string) {
        classes.add(name);
      },
      remove(name: string) {
        classes.delete(name);
      },
      contains(name: string) {
        return classes.has(name);
      },
    },
  } as unknown as HTMLElement;
}

describe("createEphemeralToast", () => {
  it("shows a message and hides after the duration", () => {
    vi.useFakeTimers();
    const root = mockToastRoot();
    const toast = createEphemeralToast(root);

    toast.show("いっしょに作るリンクがコピーされました。友だちに教えてね。");
    expect(root.hidden).toBe(false);
    expect(root.classList.contains("is-visible")).toBe(true);
    expect(root.textContent).toBe(
      "いっしょに作るリンクがコピーされました。友だちに教えてね。",
    );

    vi.advanceTimersByTime(EPHEMERAL_TOAST_DEFAULT_MS - 1);
    expect(root.hidden).toBe(false);

    vi.advanceTimersByTime(1);
    expect(root.hidden).toBe(true);
    expect(root.classList.contains("is-visible")).toBe(false);
    expect(root.textContent).toBe("");
    toast.dispose();
    vi.useRealTimers();
  });

  it("restarts the hide timer when shown again", () => {
    vi.useFakeTimers();
    const root = mockToastRoot();
    const toast = createEphemeralToast(root);

    toast.show("ひとつめ", 1000);
    vi.advanceTimersByTime(800);
    toast.show("ふたつめ", 1000);
    vi.advanceTimersByTime(800);
    expect(root.textContent).toBe("ふたつめ");
    expect(root.hidden).toBe(false);
    vi.advanceTimersByTime(200);
    expect(root.hidden).toBe(true);
    toast.dispose();
    vi.useRealTimers();
  });
});
