import {mkdtempSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {describe, expect, it} from "vitest";
import {contentTypeFor, resolveSafePath} from "./static.js";

describe("collab-host static helpers", () => {
  it("maps common asset content types", () => {
    expect(contentTypeFor("x.js")).toContain("javascript");
    expect(contentTypeFor("x.wasm")).toBe("application/wasm");
    expect(contentTypeFor("x.html")).toContain("html");
  });

  it("resolves index for / and rejects path escape attempts", () => {
    const root = mkdtempSync(join(tmpdir(), "collab-host-static-"));
    writeFileSync(join(root, "index.html"), "<html>ok</html>");
    expect(resolveSafePath(root, "/")).toBe(join(root, "index.html"));
    expect(resolveSafePath(root, "/../secret")).toBeNull();
    expect(resolveSafePath(root, "/assets/app.js")).toBe(
      join(root, "assets/app.js"),
    );
  });
});
