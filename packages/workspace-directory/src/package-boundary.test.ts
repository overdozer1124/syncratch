import {readFileSync} from "node:fs";
import {describe, expect, it} from "vitest";

describe("package boundary", () => {
  it("declares no runtime dependencies and no sqlite/hono/react imports", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    expect(pkg.dependencies ?? {}).toEqual({});

    const sources = [
      "ids.ts",
      "validation.ts",
      "models.ts",
      "access.ts",
      "conflicts.ts",
      "errors.ts",
      "last-owner.ts",
      "repository.ts",
      "roster-import.ts",
      "index.ts",
    ];
    for (const file of sources) {
      const text = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
      expect(text).not.toMatch(
        /better-sqlite3|from ["']hono|from ["']react|project-store-sqlite/,
      );
    }
  });
});
