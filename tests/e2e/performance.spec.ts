import { type Page, test } from "@playwright/test";
import type { GenerateLargeDocumentOptions } from "@/tests/helpers/document-generators";
import { generateLargeDocument } from "@/tests/helpers/document-generators";
import { EditorPage } from "./helpers/editor-page";
import {
  collectPerfEntries,
  computeLatencyStats,
  injectPerfObserver,
} from "./helpers/perf-observer";

const DEFAULT_HEADINGS = [10, 50];
const PERF_HEADINGS = process.env.PERF_HEADINGS?.trim()
  ? process.env.PERF_HEADINGS.split(",").map((s) =>
      Number.parseInt(s.trim(), 10),
    )
  : DEFAULT_HEADINGS;

const VALID_SHAPES = ["flat", "deep", "mixed"] as const;
const PERF_SHAPE: GenerateLargeDocumentOptions["shape"] =
  process.env.PERF_SHAPE?.trim() &&
  VALID_SHAPES.includes(
    process.env.PERF_SHAPE.trim() as (typeof VALID_SHAPES)[number],
  )
    ? (process.env.PERF_SHAPE.trim() as (typeof VALID_SHAPES)[number])
    : "flat";

async function measureTypingLatency(
  page: Page,
  headingCount: number,
  shape: GenerateLargeDocumentOptions["shape"],
) {
  await injectPerfObserver(page);
  const editorPage = new EditorPage(page);
  await editorPage.goto();
  await editorPage.waitForSync();
  await editorPage.setContent(generateLargeDocument(headingCount, { shape }));
  await page.click(".tiptap p");
  await page.keyboard.type("a".repeat(100), { delay: 10 });
  const entries = await collectPerfEntries(page);
  return computeLatencyStats(entries);
}

function logStats(
  label: string,
  stats: ReturnType<typeof computeLatencyStats>,
) {
  console.log(`=== Performance: ${label} ===`);
  console.log(`Samples: ${stats.count}`);
  console.log(`p50: ${stats.p50.toFixed(1)}ms`);
  console.log(`p95: ${stats.p95.toFixed(1)}ms`);
  console.log(`Mean: ${stats.mean.toFixed(1)}ms`);
  console.log(`Max: ${stats.max.toFixed(1)}ms`);
}

for (const n of PERF_HEADINGS) {
  test(`typing latency with ${n} headings (${PERF_SHAPE})`, async ({
    page,
  }) => {
    const stats = await measureTypingLatency(page, n, PERF_SHAPE);
    logStats(`${n} headings (${PERF_SHAPE})`, stats);
  });
}
