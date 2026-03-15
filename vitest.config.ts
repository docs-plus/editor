import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.ts"],
    exclude: ["tests/e2e/**", "tests/load/**"],
    reporters: process.env.VITEST_REPORT_FILE
      ? ["default", ["json", { outputFile: process.env.VITEST_REPORT_FILE }]]
      : ["default"],
  },
  resolve: {
    tsconfigPaths: true,
    conditions: ["import", "default"],
  },
});
