import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /persist\.spec\.ts$/,
  timeout: 180_000,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: { trace: "retain-on-failure" },
});
