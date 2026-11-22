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
        "**/desktop-seams.spec.ts",
        "**/local/**",
        "**/library-sidebar.spec.ts",
        "**/performance.spec.ts",
        "**/toolbar-perf.spec.ts",
        "**/image-asset-encoder-perf.spec.ts",
      ],
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      // Safari's engine, run by hand (CI runs chromium only):
      // `bun playwright test --project=webkit`. Covers the core editing
      // surfaces; tests that drive Chromium's DevTools protocol (heap and
      // listener counts, raw touch events, CPU throttling) skip here.
      name: "webkit",
      testMatch: [
        "**/toolbar*.spec.ts",
        "**/selection-bubble.spec.ts",
        "**/paint-format.spec.ts",
        "**/palette*.spec.ts",
        "**/slash-menu.spec.ts",
        "**/continue-chip.spec.ts",
        "**/action-preview.spec.ts",
        "**/mobile-bar*.spec.ts",
        "**/collaboration.spec.ts",
        "**/editor-leak.spec.ts",
        "**/image-metadata.spec.ts",
        "**/image-asset-encoder.spec.ts",
      ],
      testIgnore: ["**/toolbar-perf.spec.ts"],
      use: {
        browserName: "webkit",
        viewport: { width: 1280, height: 720 },
      },
    },
    {
      // The typing budget compares timings, so it runs alone: after the
      // chromium suite (when both are selected), on one worker. Run it by
      // itself with `--project=perf --no-deps`.
      name: "perf",
      testMatch: [
        "**/performance.spec.ts",
        "**/toolbar-perf.spec.ts",
        "**/image-asset-encoder-perf.spec.ts",
      ],
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
      // Needs a desktop-flag production build (NEXT_PUBLIC_APP_TARGET=desktop);
      // see the spec's header.
      name: "desktop",
      testMatch: ["**/desktop-seams.spec.ts"],
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 720 },
        baseURL: process.env.DESKTOP_BASE_URL ?? "http://localhost:3849",
      },
    },
    {
      // The desktop renderer over the dev bridge, no Hocus (architecture
      // §11): needs a desktop-target dev server; see tests/TESTING.md.
      name: "local",
      testMatch: ["**/local/*.spec.ts"],
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 720 },
        baseURL: process.env.LOCAL_BASE_URL ?? "http://localhost:3926",
      },
    },
    {
      // The shared library UI (components/library) on its Bun harness, with
      // no Next.js or Hocus: `bun tests/harness/library/serve.ts` first.
      name: "library",
      testMatch: ["**/library-sidebar.spec.ts"],
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 800 },
        baseURL: process.env.LIBRARY_BASE_URL ?? "http://127.0.0.1:3871",
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
