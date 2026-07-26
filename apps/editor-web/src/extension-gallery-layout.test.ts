import {readFileSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, expect, it} from "vitest";

const styleCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "style.css"),
  "utf8",
);

describe("extension gallery layout", () => {
  it("uses a 3-column grid for desktop gallery cards", () => {
    expect(styleCss).toMatch(
      /\.extension-gallery-grid\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s,
    );
    expect(styleCss).toMatch(
      /\.extension-gallery-panel\s*\{[^}]*width:\s*min\(1280px,\s*100%\)/s,
    );
    // Fixed 300px cards forced a 2-column wrap and left empty right space.
    expect(styleCss).not.toMatch(
      /\.extension-gallery-card\s*\{[^}]*flex:\s*0\s+0\s+300px/s,
    );
  });
});
