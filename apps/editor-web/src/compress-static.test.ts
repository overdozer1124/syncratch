import {describe, expect, it} from "vitest";
import {shouldGzipStaticAsset} from "./compress-static.js";

describe("shouldGzipStaticAsset", () => {
  it("gzips large JS when the client accepts gzip", () => {
    expect(
      shouldGzipStaticAsset(
        "/generated/gui/scratch-gui-standalone.js",
        "gzip, deflate, br",
        17_000_000,
      ),
    ).toBe(true);
  });

  it("skips small assets and clients without gzip", () => {
    expect(
      shouldGzipStaticAsset("/static/icon.svg", "gzip", 1_024),
    ).toBe(false);
    expect(
      shouldGzipStaticAsset(
        "/generated/gui/scratch-gui-standalone.js",
        "identity",
        17_000_000,
      ),
    ).toBe(false);
  });
});
