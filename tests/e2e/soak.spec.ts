import { expect, test } from "@playwright/test";
import { generateLargeDocument } from "@/tests/helpers/document-generators";
import { EditorPage } from "./helpers/editor-page";
import {
  collectPerfEntries,
  computeLatencyStats,
  injectPerfObserver,
} from "./helpers/perf-observer";
import { SoakBot } from "./helpers/soak-bot";
import { runAllJourneys } from "./helpers/soak-journeys";

const SOAK_DURATION = Number(process.env.SOAK_DURATION ?? 1_800_000);
const SOAK_HEADINGS = Number(process.env.SOAK_HEADINGS ?? 200);
const MEMORY_GROWTH_LIMIT = 50;
const WARMUP_DURATION = Number(
  process.env.SOAK_WARMUP ?? (SOAK_DURATION < 600_000 ? 30_000 : 120_000),
);

test.setTimeout(SOAK_DURATION + 300_000);

test("single-user soak — sustained editing with memory tracking", async ({
  page,
}) => {
  await injectPerfObserver(page);
  const ep = new EditorPage(page);
  await ep.goto();
  await ep.waitForSync();
  await ep.setContent(generateLargeDocument(SOAK_HEADINGS));

  const journeyResults = await runAllJourneys(page, ep);
  for (const j of journeyResults) {
    console.log(
      `[journey] ${j.name}: p95=${j.p95.toFixed(1)}ms (threshold ${j.threshold}ms) — ${j.pass ? "PASS" : "FAIL"}`,
    );
    expect(
      j.pass,
      `Journey "${j.name}" failed: p95=${j.p95.toFixed(1)}ms > ${j.threshold}ms`,
    ).toBe(true);
  }

  const warmupBot = new SoakBot(ep, page);
  await warmupBot.runFor(WARMUP_DURATION, { delayBetweenMs: 500 });
  const baselineHeap = await ep.getHeapSize();

  const memorySamples: Array<{ elapsed: number; heap: number }> = [];
  const bot = new SoakBot(ep, page);
  const soakStats = await bot.runFor(SOAK_DURATION, {
    delayBetweenMs: 200,
    intervalMs: 30_000,
    onInterval: async (elapsed) => {
      const heap = await ep.getHeapSize();
      if (heap !== null) {
        memorySamples.push({ elapsed, heap });
      }
    },
  });

  const finalHeap = await ep.getHeapSize();
  const growthPercent =
    baselineHeap && finalHeap
      ? ((finalHeap - baselineHeap) / baselineHeap) * 100
      : null;

  const entries = await collectPerfEntries(page);
  const latency = computeLatencyStats(entries);

  const report = {
    timestamp: new Date().toISOString(),
    headingCount: SOAK_HEADINGS,
    duration: {
      configured: SOAK_DURATION,
      actual: SOAK_DURATION + WARMUP_DURATION,
    },
    journeys: journeyResults,
    soak: soakStats,
    memory: { baselineHeap, finalHeap, growthPercent, samples: memorySamples },
    latency,
    verdict: "PASS" as "PASS" | "FAIL",
    failReasons: [] as string[],
  };

  if (growthPercent !== null && growthPercent >= MEMORY_GROWTH_LIMIT) {
    report.verdict = "FAIL";
    report.failReasons.push(
      `Memory grew ${growthPercent.toFixed(1)}% (limit: ${MEMORY_GROWTH_LIMIT}%)`,
    );
  }
  if (soakStats.errors.length > 0) {
    report.verdict = "FAIL";
    report.failReasons.push(`${soakStats.errors.length} action errors`);
  }

  console.log("\n=== Soak Test Report ===");
  console.log(`Duration:   ${(SOAK_DURATION / 60_000).toFixed(0)} min`);
  console.log(`Headings:   ${SOAK_HEADINGS}`);
  console.log(`Actions:    ${soakStats.totalActions}`);
  console.log(`Errors:     ${soakStats.errors.length}`);
  console.log(
    `Memory:     ${growthPercent !== null ? `${growthPercent.toFixed(1)}%` : "N/A (non-Chrome)"}`,
  );
  console.log(
    `Latency:    p50=${latency.p50.toFixed(1)}ms p95=${latency.p95.toFixed(1)}ms`,
  );
  console.log(`Verdict:    ${report.verdict}`);

  const fs = await import("node:fs");
  const path = await import("node:path");
  const outDir = path.join(process.cwd(), "test-reports");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, `soak-report-${Date.now()}.json`),
    JSON.stringify(report, null, 2),
  );

  if (growthPercent !== null) {
    expect(growthPercent).toBeLessThan(MEMORY_GROWTH_LIMIT);
  }
  expect(soakStats.errors).toHaveLength(0);
});
