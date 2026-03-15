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
      use: { browserName: "chromium" },
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
    },
  ],
  webServer: process.env.CI
    ? {
        command: "make dev",
        url: "http://localhost:3000",
        timeout: 60_000,
      }
    : undefined,
});
