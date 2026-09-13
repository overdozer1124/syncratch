import {readFile} from "node:fs/promises";
import {describe, expect, it} from "vitest";

describe("Drive boot gate", () => {
  it("ships every Drive control disabled before editor boot completes", async () => {
    const html = await readFile(new URL("../index.html", import.meta.url), "utf8");

    for (const id of [
      "connect-google",
      "open-drive",
      "save-drive",
      "disconnect-google",
    ]) {
      expect(html).toMatch(new RegExp(`<button[^>]*id="${id}"[^>]*disabled`));
    }
  });

  it("places Drive controls above the long help copy so short viewports see the CTA", async () => {
    const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
    const section = html.match(
      /<div class="drive-section">[\s\S]*?<\/div>\s*<\/div>\s*<\/details>/,
    )?.[0];
    expect(section).toBeTruthy();
    const controlsAt = section!.indexOf('class="drive-controls"');
    const helpAt = section!.indexOf('class="panel-help"');
    expect(controlsAt).toBeGreaterThan(-1);
    expect(helpAt).toBeGreaterThan(-1);
    expect(controlsAt).toBeLessThan(helpAt);
  });
});
