import { defineConfig } from "@playwright/test";

/**
 * The `electron` project (desktop architecture §11; test and release
 * strategy L4): Playwright `_electron` drives the packaged app.
 *
 *   TINYDOCY_EXECUTABLE=<installed binary> CI= bun playwright test -c playwright.electron.config.ts
 *
 * Without TINYDOCY_EXECUTABLE it runs `electron dist/desktop-app` (the
 * staged folder, unpackaged). Runs on GitHub runners
 * (.github/workflows/desktop-shell.yml); locally set TINYDOCY_HIDDEN=1 so
 * no window is ever shown.
 */
export default defineConfig({
  testDir: "tests/electron",
  timeout: 120_000,
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report-electron", open: "never" }],
  ],
  outputDir: "test-results-electron",
  use: { trace: "retain-on-failure" },
  projects: [{ name: "electron" }],
});
