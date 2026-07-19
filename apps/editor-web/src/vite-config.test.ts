import {describe, expect, it} from "vitest";
import config from "../vite.config.js";

function inputsFor(mode: string): Record<string, string> {
  expect(typeof config).toBe("function");
  if (typeof config !== "function") return {};
  const resolved = config({
    command: "build",
    mode,
    isSsrBuild: false,
    isPreview: false,
  });
  expect(resolved).not.toBeInstanceOf(Promise);
  if (resolved instanceof Promise) return {};
  return resolved.build?.rollupOptions?.input as Record<string, string>;
}

function resolvedFor(mode: string) {
  expect(typeof config).toBe("function");
  if (typeof config !== "function") return {};
  return config({
    command: "build",
    mode,
    isSsrBuild: false,
    isPreview: false,
  });
}

describe("editor Vite entries", () => {
  it("excludes the collaboration harness from production builds", () => {
    expect(Object.keys(inputsFor("production"))).toEqual(["main"]);
  });

  it("includes the collaboration harness only in E2E builds", () => {
    expect(Object.keys(inputsFor("e2e")).sort()).toEqual([
      "collab-harness",
      "main",
    ]);
  });

  it("uses an explicit static-host base path", () => {
    const previous = process.env.BLOCKSYNC_BASE_PATH;
    delete process.env.BLOCKSYNC_BASE_PATH;
    try {
      expect(resolvedFor("production")).toMatchObject({base: "/"});
    } finally {
      if (previous === undefined) delete process.env.BLOCKSYNC_BASE_PATH;
      else process.env.BLOCKSYNC_BASE_PATH = previous;
    }
  });
});
