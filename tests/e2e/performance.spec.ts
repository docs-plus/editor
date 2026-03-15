import { type Page, test } from "@playwright/test";
import { generateLargeDocument } from "@/tests/helpers/document-generators";
import { parsePerfHeadings, parsePerfShape } from "@/tests/helpers/perf-config";
import { writeReport } from "@/tests/helpers/report-writer";
import { EditorPage } from "./helpers/editor-page";
import {
  collectPerfEntries,
  computeLatencyStats,
  injectPerfObserver,
  logLatencyStats,
} from "./helpers/perf-observer";

const PERF_HEADINGS = parsePerfHeadings(process.env.PERF_HEADINGS, [10, 50]);
const PERF_SHAPE = parsePerfShape(process.env.PERF_SHAPE);

const perfResults: Array<{
  label: string;
  headingCount: number;
  shape: string;
  stats: ReturnType<typeof computeLatencyStats>;
}> = [];

async function measureTypingLatency(
  page: Page,
  headingCount: number,
  shape: "flat" | "deep" | "mixed",
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

test.describe("typing latency", () => {
  test.afterAll(() => {
    writeReport(`perf-report-${Date.now()}.json`, {
      timestamp: new Date().toISOString(),
      shape: PERF_SHAPE,
      results: perfResults,
    });
  });

  for (const n of PERF_HEADINGS) {
    test(`typing latency with ${n} headings (${PERF_SHAPE})`, async ({
      page,
    }) => {
      const stats = await measureTypingLatency(page, n, PERF_SHAPE);
      logLatencyStats(`${n} headings (${PERF_SHAPE})`, stats);
      perfResults.push({
        label: `${n} headings (${PERF_SHAPE})`,
        headingCount: n,
        shape: PERF_SHAPE,
        stats,
      });
    });
  }
});
