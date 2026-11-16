import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: /s1\.spec\.ts$/,
  timeout: 180_000,
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    [
      "html",
      {
        outputFolder: `playwright-report-${process.env.SPIKE_ORIGIN ?? "app"}`,
        open: "never",
      },
    ],
  ],
  use: { trace: "retain-on-failure" },
});
