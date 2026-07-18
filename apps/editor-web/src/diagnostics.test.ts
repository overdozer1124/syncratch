import {describe, expect, it} from "vitest";
import {shouldExposeTask3Diagnostics} from "./diagnostics.js";

describe("Task 3 diagnostics exposure", () => {
  it("is enabled only for the dedicated Vite e2e mode", () => {
    expect(shouldExposeTask3Diagnostics("e2e")).toBe(true);
    expect(shouldExposeTask3Diagnostics("production")).toBe(false);
    expect(shouldExposeTask3Diagnostics("development")).toBe(false);
  });
});
