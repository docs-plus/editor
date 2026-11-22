import type { Page } from "@playwright/test";

import type { EditorPage } from "./editor-page";
import {
  collectPerfEntries,
  computeLatencyStats,
  type PerfEntry,
} from "./perf-observer";

/** Keystrokes: a key typed into the document or a field. */
const LATENCY_THRESHOLD_MS = 100;
/**
 * Commands: a keystroke that runs a whole-document action (open the filter
 * bar, commit a filter). One interaction each, judged at INP's "good"
 * bound; typing stays at 100 ms. See tests/TESTING.md, "Soak journeys".
 */
const COMMAND_THRESHOLD_MS = 200;
const STEP_MARK = "soak-step:";

type StepEntry = PerfEntry & { step: string };

/** Marks the start of a journey step, so events can be attributed. */
async function markStep(page: Page, label: string): Promise<void> {
  await page.evaluate((name) => performance.mark(name), `${STEP_MARK}${label}`);
}

/** Tags each entry with the step it started in, then clears the marks. */
async function labelSteps(
  page: Page,
  entries: PerfEntry[],
): Promise<StepEntry[]> {
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
  await page.evaluate(() => performance.clearMarks());
  const stepAt = (time: number) =>
    marks.filter((mark) => mark.at <= time).at(-1)?.step ?? "before";
  return entries.map((entry) => ({ ...entry, step: stepAt(entry.startTime) }));
}

/**
 * Logs a journey's slowest events with the step they fell in and where the
 * time went: waiting for the main thread (input delay), the handlers
 * (processing), or rendering until the next paint (presentation).
 */
function logSlowestEvents(journey: string, entries: StepEntry[]): void {
  const slowest = [...entries]
    .sort((a, b) => b.duration - a.duration)
    .slice(0, 5)
    .map((entry) => ({
      step: entry.step,
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

  const entries = await labelSteps(page, await collectPerfEntries(page));
  logSlowestEvents("typing-and-structural", entries);
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

const COMMAND_STEP = /^(open|commit|clear)-/;

/**
 * Edits while a filter is active, three rounds of: open the filter bar,
 * type a term, commit it, type in the filtered document, clear it. Two
 * results: the typing keystrokes at 100 ms and the commands (the bar's
 * shortcut, Enter to commit) at 200 ms. Clear is a click, which the event
 * observer does not record.
 */
export async function filterLifecycleJourney(
  page: Page,
  ep: EditorPage,
): Promise<JourneyResult[]> {
  const start = Date.now();
  let commands = 0;
  let keystrokes = 0;

  for (let round = 0; round < 3; round++) {
    await page.click(".tiptap");
    const filterInput = page.getByLabel("Filter term");
    const alreadyVisible = await filterInput.isVisible().catch(() => false);
    if (!alreadyVisible) {
      await markStep(page, `open-${round}`);
      await ep.openFilter();
      await page.waitForTimeout(500);
      commands += 1;
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
    commands += 2;
    keystrokes += "Filtered edit ".length;
  }

  const entries = await labelSteps(page, await collectPerfEntries(page));
  logSlowestEvents("filter-lifecycle", entries);
  const durationMs = Date.now() - start;
  const typing = computeLatencyStats(
    entries.filter((entry) => !COMMAND_STEP.test(entry.step)),
  );
  const command = computeLatencyStats(
    entries.filter((entry) => COMMAND_STEP.test(entry.step)),
  );

  return [
    {
      name: "filter-lifecycle typing",
      pass: typing.p95 < LATENCY_THRESHOLD_MS,
      p95: typing.p95,
      threshold: LATENCY_THRESHOLD_MS,
      actionCount: keystrokes,
      durationMs,
    },
    {
      name: "filter-lifecycle commands",
      pass: command.p95 < COMMAND_THRESHOLD_MS,
      p95: command.p95,
      threshold: COMMAND_THRESHOLD_MS,
      actionCount: commands,
      durationMs,
    },
  ];
}

export async function runAllJourneys(
  page: Page,
  ep: EditorPage,
): Promise<JourneyResult[]> {
  return [
    await typingAndStructuralJourney(page, ep),
    ...(await filterLifecycleJourney(page, ep)),
  ];
}
