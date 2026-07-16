import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["spike/**/*.test.ts"],
    testTimeout: 120_000,
  },
});
