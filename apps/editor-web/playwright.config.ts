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
    launchOptions: {
      // Expose loopback host ICE candidates so two Chromium contexts on the same
      // machine can establish a real WebRTC data channel without mDNS/STUN/TURN.
      args: [
        "--disable-features=WebRtcHideLocalIpsWithMdns",
      ],
    },
  },
  webServer: [
    {
      command: "pnpm build:e2e && pnpm exec vite preview",
      port: 4173,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        VITE_COLLAB_SIGNALING_URL: "ws://127.0.0.1:4455",
      },
    },
    {
      command: "pnpm --filter @blocksync/collab-signaling start",
      port: 4455,
      env: {PORT: "4455"},
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
