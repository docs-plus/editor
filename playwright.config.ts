import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  workers: 3,
  reporter: process.env.PLAYWRIGHT_REPORT_FILE
    ? [["list"], ["json", { outputFile: process.env.PLAYWRIGHT_REPORT_FILE }]]
    : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    headless: true,
    // Only the production-build `pwa` project runs the service worker.
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "chromium",
      testMatch: ["**/*.spec.ts"],
      testIgnore: [
        "**/soak*.spec.ts",
        "**/yjs-soak/**",
        "**/pwa-offline.spec.ts",
        "**/performance.spec.ts",
        "**/toolbar-perf.spec.ts",
      ],
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      // The typing budget compares timings, so it runs alone: after the
      // chromium suite (when both are selected), on one worker. Run it by
      // itself with `--project=perf --no-deps`.
      name: "perf",
      testMatch: ["**/performance.spec.ts", "**/toolbar-perf.spec.ts"],
      dependencies: ["chromium"],
      workers: 1,
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      // Needs a production build: `bun run build && PORT=3847 bun run start`.
      name: "pwa",
      testMatch: ["**/pwa-offline.spec.ts"],
      workers: 1,
      use: {
        browserName: "chromium",
        baseURL: process.env.PWA_BASE_URL ?? "http://localhost:3847",
        serviceWorkers: "allow",
      },
    },
    {
      name: "soak",
      testMatch: ["**/soak.spec.ts", "**/soak-collab.spec.ts"],
      use: { browserName: "chromium" },
      timeout: 2_400_000,
    },
    {
      name: "yjs-soak",
      testMatch: ["**/yjs-soak/**"],
      use: { browserName: "chromium" },
      timeout: 900_000,
      workers: 1,
    },
  ],
  webServer: process.env.CI
    ? {
        command:
          "DOC_CREATION_RATE_LIMIT=2000 WS_CONNECTION_LIMIT=200 WS_SOCKETS_PER_IP=600 WS_UPGRADE_RATE_LIMIT=6000 HOCUS_THROTTLE=0 make dev",
        url: process.env.E2E_BASE_URL ?? "http://localhost:3000",
        timeout: 60_000,
      }
    : undefined,
});
