import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./spike",
  testMatch: "browser-smoke.spec.ts",
  timeout: 120_000,
  use: {
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: "node spike/browser/serve-task0.mjs",
    port: 8765,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
