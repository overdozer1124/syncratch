import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const styleCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "style.css"),
  "utf8",
);

describe("Scratch modal vs Syncratch toolbar stacking", () => {
  it("keeps toolbar above Scratch menu-bar but below Scratch modals", () => {
    expect(styleCss).toMatch(/--syncratch-toolbar-z:\s*600/);
    expect(styleCss).toMatch(/--syncratch-modal-z:\s*800/);
    expect(styleCss).toContain('z-index: var(--syncratch-toolbar-z)');
    expect(styleCss).toContain(
      "z-index: var(--syncratch-modal-z) !important",
    );
  });

  it("raises portaled Scratch modal overlays (not scoped under #scratch-gui)", () => {
    expect(styleCss).toContain('[class*="modal_modal-overlay_"]');
    expect(styleCss).not.toContain(
      '#scratch-gui [class*="modal_modal-overlay_"]',
    );
  });

  it("hides Syncratch toolbar while a full-screen library modal is open", () => {
    expect(styleCss).toContain(
      'body:has([class*="modal_full-screen_"]) .toolbar',
    );
    expect(styleCss).toMatch(
      /body:has\(\[class\*="modal_full-screen_"\]\) \.toolbar\s*\{[^}]*visibility:\s*hidden/s,
    );
  });
});
