import { defineConfig } from "@playwright/test";

// Spike S5: one worker, so arms never compete for the CPU.
export default defineConfig({
  testDir: ".",
  testMatch: ["latency.spec.ts"],
  workers: 1,
  timeout: 0,
  reporter: "list",
});
