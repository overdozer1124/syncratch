import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const root = dirname(fileURLToPath(import.meta.url));
const styleCss = readFileSync(join(root, "style.css"), "utf8");
const indexHtml = readFileSync(join(root, "../index.html"), "utf8");

describe("AI panel Claude Design blue theme", () => {
  it("uses cool blue thread surfaces instead of yellow or gray washes", () => {
    expect(styleCss).toMatch(/--sc-ai-thread-bg:\s*#eff5fb/i);
    expect(styleCss).toMatch(/--sc-accent-ai:\s*#1565a9/i);
    expect(styleCss).not.toMatch(/--sc-ai-thread-bg:\s*#fff6e0/i);
    expect(styleCss).not.toMatch(
      /\.ai-answer-pager\s*\{[^}]*background:\s*rgb\(0 0 0 \/ 12%\)/s,
    );
    expect(styleCss).not.toMatch(
      /\.ai-thread-turn-assistant\s*\{[^}]*background:\s*rgb\(0 0 0 \/ 22%\)/s,
    );
  });

  it("keeps Syncratch chrome blue and star badge (not legacy purple)", () => {
    expect(styleCss).not.toMatch(/--sc-accent-ai:\s*#6b57c9/i);
    expect(indexHtml).toContain('class="ai-panel-badge"');
    expect(indexHtml).toContain('class="ai-compose"');
    expect(indexHtml).toContain('class="ai-panel-body"');
    expect(indexHtml).not.toContain('fill="#6b57c9"');
  });

  it("keeps clarify choice focus text dark on a light blue hover", () => {
    expect(styleCss).toMatch(
      /\.ai-clarify-choices[\s\S]*?button:hover[\s\S]*?background:\s*var\(--sc-accent-ai-soft\)/i,
    );
    expect(styleCss).toMatch(
      /\.ai-clarify-choices[\s\S]*?button:hover[\s\S]*?color:\s*var\(--sc-ink\)/i,
    );
    expect(styleCss).not.toMatch(
      /\.ai-clarify-choices button:hover[\s\S]*?background:\s*#ffe082/i,
    );
  });

  it("styles user bubbles as solid blue and AI bubbles as white cards", () => {
    expect(styleCss).toMatch(/--sc-ai-user-bg:\s*#1565a9/i);
    expect(styleCss).toMatch(/--sc-ai-assistant-bg:\s*#ffffff/i);
    expect(styleCss).toMatch(/\.ai-choice__key\s*\{/);
  });
});
