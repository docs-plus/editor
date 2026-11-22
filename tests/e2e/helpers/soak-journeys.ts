import type { Page } from "@playwright/test";

import type { EditorPage } from "./editor-page";
import {
  collectPerfEntries,
  computeLatencyStats,
  type PerfEntry,
} from "./perf-observer";

const LATENCY_THRESHOLD_MS = 100;
const STEP_MARK = "soak-step:";

/** Marks the start of a journey step, so slow events can be attributed. */
async function markStep(page: Page, label: string): Promise<void> {
  await page.evaluate((name) => performance.mark(name), `${STEP_MARK}${label}`);
}

/**
 * Logs a journey's slowest events with the step they fell in and where the
 * time went: waiting for the main thread (input delay), the handlers
 * (processing), or rendering until the next paint (presentation).
 */
async function logSlowestEvents(
  page: Page,
  journey: string,
  entries: PerfEntry[],
): Promise<void> {
  const marks = await page.evaluate(
    (prefix) =>
      performance
        .getEntriesByType("mark")
        .filter((mark) => mark.name.startsWith(prefix))
        .map((mark) => ({
          step: mark.name.slice(prefix.length),
          at: mark.startTime,
        })),
    STEP_MARK,
  );
  const stepAt = (time: number) =>
    marks.filter((mark) => mark.at <= time).at(-1)?.step ?? "before";
  const slowest = [...entries]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 5)
    .map((entry) => ({
      step: stepAt(entry.startTime),
      event: entry.name,
      duration: entry.duration,
      inputDelay: Math.round(entry.processingStart - entry.startTime),
      processing: Math.round(entry.processingEnd - entry.processingStart),
      presentation: Math.round(
        entry.startTime + entry.duration - entry.processingEnd,
      ),
    }));
  console.log(
    `[journey] ${journey}: ${entries.length} events >= 16 ms, slowest`,
    JSON.stringify(slowest),
  );
  await page.evaluate(() => performance.clearMarks());
}

export interface JourneyResult {
  name: string;
  pass: boolean;
  p95: number;
  threshold: number;
  actionCount: number;
  durationMs: number;
}

export async function typingAndStructuralJourney(
  page: Page,
  ep: EditorPage,
): Promise<JourneyResult> {
  const start = Date.now();
  let actionCount = 0;

  await page.click(".tiptap");
  await markStep(page, "type");
  await ep.typeText("a".repeat(50), { delay: 30 });
  actionCount += 50;

  for (let i = 0; i < 2; i++) {
    await markStep(page, `enter-${i}`);
    await ep.pressKey("Enter");
    await markStep(page, `heading-level-${i}`);
    await ep.changeHeadingLevel(2);
    await markStep(page, `type-heading-${i}`);
    await ep.typeText(`Journey Heading ${i + 1}`);
    actionCount += 3;
  }

  await markStep(page, "undo-redo");
  await ep.undo();
  await ep.redo();
  actionCount += 2;

  const entries = await collectPerfEntries(page);
  await logSlowestEvents(page, "typing-and-structural", entries);
  const stats = computeLatencyStats(entries);
  const durationMs = Date.now() - start;

  return {
    name: "typing-and-structural",
    pass: stats.p95 < LATENCY_THRESHOLD_MS,
    p95: stats.p95,
    threshold: LATENCY_THRESHOLD_MS,
    actionCount,
    durationMs,
  };
}

export async function filterLifecycleJourney(
  page: Page,
  ep: EditorPage,
): Promise<JourneyResult> {
  const start = Date.now();
  let actionCount = 0;

  for (let round = 0; round < 3; round++) {
    await page.click(".tiptap");
    const filterInput = page.getByLabel("Filter term");
    const alreadyVisible = await filterInput.isVisible().catch(() => false);
    if (!alreadyVisible) {
      await markStep(page, `open-${round}`);
      await ep.openFilter();
      await page.waitForTimeout(500);
    }
    const visible = await filterInput.isVisible().catch(() => false);
    if (!visible) continue;
    await markStep(page, `type-filter-${round}`);
    await ep.typeFilter("Section");
    await markStep(page, `commit-${round}`);
    await ep.commitFilter();
    await page.click(".tiptap");
    await markStep(page, `type-filtered-${round}`);
    await ep.typeText("Filtered edit ");
    await markStep(page, `clear-${round}`);
    await ep.clearFilter();
    actionCount += 6;
  }

  const entries = await collectPerfEntries(page);
  await logSlowestEvents(page, "filter-lifecycle", entries);
  const stats = computeLatencyStats(entries);
  const durationMs = Date.now() - start;

  return {
    name: "filter-lifecycle",
    pass: stats.p95 < LATENCY_THRESHOLD_MS,
    p95: stats.p95,
    threshold: LATENCY_THRESHOLD_MS,
    actionCount,
    durationMs,
  };
}

export async function runAllJourneys(
  page: Page,
  ep: EditorPage,
): Promise<JourneyResult[]> {
  return [
    await typingAndStructuralJourney(page, ep),
    await filterLifecycleJourney(page, ep),
  ];
}
