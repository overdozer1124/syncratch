import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const styleCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "style.css"),
  "utf8",
);

describe("extension gallery layout", () => {
  it("lays out three columns without CSS-grid card squashing", () => {
    expect(styleCss).toMatch(
      /\.extension-gallery-grid\s*\{[^}]*--extension-gallery-cols:\s*3/s,
    );
    expect(styleCss).toMatch(
      /\.extension-gallery-panel\s*\{[^}]*width:\s*min\(1280px,\s*100%\)/s,
    );
    // Prefer flex-wrap + column calc; CSS grid minmax(0,1fr) flattened cards.
    expect(styleCss).toMatch(
      /\.extension-gallery-grid\s*\{[^}]*display:\s*flex/s,
    );
    expect(styleCss).not.toMatch(
      /\.extension-gallery-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0/s,
    );
    expect(styleCss).toMatch(
      /\.extension-gallery-card-icon[^}]*aspect-ratio:\s*600\s*\/\s*372/s,
    );
  });
});
