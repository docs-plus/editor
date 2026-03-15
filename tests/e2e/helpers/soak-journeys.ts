import type { Page } from "@playwright/test";
import type { EditorPage } from "./editor-page";
import { collectPerfEntries, computeLatencyStats } from "./perf-observer";

const LATENCY_THRESHOLD_MS = 100;

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

  await ep.typeText("a".repeat(200), { delay: 10 });
  actionCount += 200;

  for (let i = 0; i < 3; i++) {
    await ep.pressKey("Enter");
    await ep.changeHeadingLevel(2);
    await ep.typeText(`Section ${i + 1}`);
    actionCount += 3;
  }

  const headings = await ep.getHeadingsWithTocIds();
  const bodyHeadings = headings.filter(
    (h) => h.level !== undefined && h.level > 1,
  );
  for (const h of bodyHeadings.slice(0, 3)) {
    await ep.clickFoldChevron(h.tocId);
    actionCount++;
  }

  for (const h of bodyHeadings.slice(0, 3)) {
    await ep.clickFoldChevron(h.tocId);
    actionCount++;
  }

  const entries = await collectPerfEntries(page);
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
    await ep.openFilter();
    await ep.typeFilter("Section");
    await ep.commitFilter();
    await page.click(".tiptap");
    await ep.typeText("Filtered edit ");
    await ep.clearFilter();
    actionCount += 6;
  }

  const entries = await collectPerfEntries(page);
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
