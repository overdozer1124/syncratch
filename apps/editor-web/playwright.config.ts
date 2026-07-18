import {defineConfig} from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: {timeout: 30_000},
  use: {
    baseURL: "http://127.0.0.1:4173",
    headless: true,
    viewport: {width: 1280, height: 800},
    acceptDownloads: true,
  },
  webServer: {
    command: "pnpm build && pnpm exec vite preview",
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
