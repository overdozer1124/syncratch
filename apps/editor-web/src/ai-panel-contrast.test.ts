import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const root = dirname(fileURLToPath(import.meta.url));
const styleCss = readFileSync(join(root, "style.css"), "utf8");
const indexHtml = readFileSync(join(root, "../index.html"), "utf8");

describe("AI panel contrast and Scratch blue accents", () => {
  it("uses warm yellow thread surfaces instead of gray washes", () => {
    expect(styleCss).toMatch(/--sc-ai-thread-bg:\s*#fff6e0/i);
    expect(styleCss).toMatch(/--sc-ai-clarify-bg:\s*#fff8d6/i);
    expect(styleCss).not.toMatch(
      /\.ai-answer-pager\s*\{[^}]*background:\s*rgb\(0 0 0 \/ 12%\)/s,
    );
    expect(styleCss).not.toMatch(
      /\.ai-thread-turn-assistant\s*\{[^}]*background:\s*rgb\(0 0 0 \/ 22%\)/s,
    );
  });

  it("uses current Scratch blue instead of legacy purple for AI chrome", () => {
    expect(styleCss).toMatch(/--sc-accent-ai:\s*#4c97ff/i);
    expect(styleCss).not.toMatch(/--sc-accent-ai:\s*#6b57c9/i);
    expect(indexHtml).toContain('fill="#4c97ff"');
    expect(indexHtml).not.toContain('fill="#6b57c9"');
  });

  it("keeps clarify choice focus text dark on a light yellow hover", () => {
    expect(styleCss).toMatch(
      /\.ai-clarify-choices button:hover[\s\S]*?background:\s*#ffe082/i,
    );
    expect(styleCss).toMatch(
      /\.ai-clarify-choices button:hover[\s\S]*?color:\s*var\(--sc-ink\)/i,
    );
  });
});
