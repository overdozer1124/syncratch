import {describe, expect, it} from "vitest";
import {
  isCollabPresenceToggleTarget,
  setCollabPresencePopoverOpen,
  toggleCollabPresencePopover,
} from "./collab-presence-ui.js";

describe("collab presence popover helpers", () => {
  it("toggles only collab/avatar status chips", () => {
    expect(
      isCollabPresenceToggleTarget({
        closest: (sel: string) =>
          sel.includes("data-status-id")
            ? {dataset: {statusId: "collab"}}
            : null,
      } as unknown as EventTarget),
    ).toBe(true);
    expect(
      isCollabPresenceToggleTarget({
        closest: () => ({dataset: {statusId: "drive"}}),
      } as unknown as EventTarget),
    ).toBe(false);
    expect(isCollabPresenceToggleTarget(null)).toBe(false);
  });

  it("opens and closes the popover flag classes", () => {
    const root = {
      hidden: true,
      classList: {
        values: new Set<string>(),
        toggle(name: string, force?: boolean) {
          const on = force ?? !this.values.has(name);
          if (on) this.values.add(name);
          else this.values.delete(name);
          return on;
        },
        contains(name: string) {
          return this.values.has(name);
        },
      },
      setAttribute() {},
    } as unknown as HTMLElement;

    setCollabPresencePopoverOpen(root, true);
    expect(root.classList.contains("is-open")).toBe(true);
    expect(root.hidden).toBe(false);
    expect(toggleCollabPresencePopover(root)).toBe(false);
    expect(root.classList.contains("is-open")).toBe(false);
    expect(root.hidden).toBe(true);
  });
});
