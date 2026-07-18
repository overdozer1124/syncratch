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
});
