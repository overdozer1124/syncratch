import {describe, expect, it} from "vitest";
import {staticAssetUrl} from "./static-url.js";

describe("staticAssetUrl", () => {
  it("resolves generated assets under a project Pages base path", () => {
    expect(staticAssetUrl(
      "generated/fixtures/cat-project.json",
      "/NewScratchEditor/",
    )).toBe("/NewScratchEditor/generated/fixtures/cat-project.json");
  });
});
