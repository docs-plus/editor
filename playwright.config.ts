import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  workers: 3,
  reporter: process.env.PLAYWRIGHT_REPORT_FILE
    ? [["list"], ["json", { outputFile: process.env.PLAYWRIGHT_REPORT_FILE }]]
    : "list",
  use: {
    baseURL: "http://localhost:3000",
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      testMatch: ["**/*.spec.ts"],
      testIgnore: ["**/soak*.spec.ts", "**/yjs-soak/**"],
      use: {
        browserName: "chromium",
        viewport: { width: 1280, height: 720 },
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
          "DOC_CREATION_RATE_LIMIT=2000 WS_CONNECTION_LIMIT=200 HOCUS_THROTTLE=0 make dev",
        url: "http://localhost:3000",
        timeout: 60_000,
      }
    : undefined,
});
