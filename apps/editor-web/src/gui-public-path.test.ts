import {describe, expect, it} from "vitest";
import {
  guiPublicPathFromEnv,
  normalizeGuiPublicPath,
  scratchGuiBasePath,
} from "./gui-public-path.js";

describe("gui public path", () => {
  it("keeps an absolute root prefix", () => {
    expect(normalizeGuiPublicPath("/")).toBe("/");
    expect(normalizeGuiPublicPath("")).toBe("/");
    expect(guiPublicPathFromEnv("/")).toBe("/");
    expect(scratchGuiBasePath("/")).toBe("/");
  });

  it("supports project Pages-style base paths", () => {
    expect(normalizeGuiPublicPath("/syncratch")).toBe("/syncratch/");
    expect(scratchGuiBasePath("/syncratch/")).toBe("/syncratch/");
  });

  it("must not track student route prefixes the way relative ./ would", () => {
    // Document the bug: relative resolution on /s/{token} points at /s/static…
    const studentPage = "https://syncratch-production.up.railway.app/s/abcdefghijklmnopqrstuv";
    const relative = new URL("./", studentPage).pathname;
    expect(relative).toBe("/s/");
    expect(`${relative}static/blocks-media/default/green-flag.svg`).toBe(
      "/s/static/blocks-media/default/green-flag.svg",
    );
    // Absolute BASE_URL stays correct for nested surfaces.
    expect(`${scratchGuiBasePath("/")}static/blocks-media/default/green-flag.svg`).toBe(
      "/static/blocks-media/default/green-flag.svg",
    );
  });
});
