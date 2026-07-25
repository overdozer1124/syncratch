import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const styleCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "style.css"),
  "utf8",
);

describe("AI panel contrast", () => {
  it("uses opaque light surfaces instead of gray-on-gray translucency", () => {
    expect(styleCss).toMatch(/--sc-ai-thread-bg:\s*#[0-9a-f]{3,8}/i);
    expect(styleCss).toMatch(/--sc-ai-assistant-bg:\s*#[0-9a-f]{3,8}/i);
    expect(styleCss).not.toMatch(
      /\.ai-answer-pager\s*\{[^}]*background:\s*rgb\(0 0 0 \/ 12%\)/s,
    );
    expect(styleCss).not.toMatch(
      /\.ai-thread-turn-assistant\s*\{[^}]*background:\s*rgb\(0 0 0 \/ 22%\)/s,
    );
    expect(styleCss).not.toMatch(
      /\.ai-thread-turn-user\s*\{[^}]*background:\s*rgb\(255 255 255 \/ 14%\)/s,
    );
  });
});
