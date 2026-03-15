import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import type { GenerateLargeDocumentOptions } from "@/tests/helpers/document-generators";
import { generateLargeDocument } from "@/tests/helpers/document-generators";
import { EditorPage } from "./helpers/editor-page";
import {
  collectPerfEntries,
  computeLatencyStats,
  injectPerfObserver,
} from "./helpers/perf-observer";

const DEFAULT_USERS = 2;
const DEFAULT_HEADINGS = 50;
const PERF_COLLAB_USERS = Number(
  process.env.PERF_COLLAB_USERS?.trim() || DEFAULT_USERS,
);
const PERF_COLLAB_HEADINGS = Number(
  process.env.PERF_COLLAB_HEADINGS?.trim() || DEFAULT_HEADINGS,
);

const VALID_SHAPES = ["flat", "deep", "mixed"] as const;
const PERF_COLLAB_SHAPE: GenerateLargeDocumentOptions["shape"] =
  process.env.PERF_COLLAB_SHAPE?.trim() &&
  VALID_SHAPES.includes(
    process.env.PERF_COLLAB_SHAPE.trim() as (typeof VALID_SHAPES)[number],
  )
    ? (process.env.PERF_COLLAB_SHAPE.trim() as (typeof VALID_SHAPES)[number])
    : "flat";

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

test.setTimeout(120_000);
test.describe.configure({ retries: 1 });

test(`typing latency with ${PERF_COLLAB_USERS} users on shared doc (${PERF_COLLAB_HEADINGS} headings, ${PERF_COLLAB_SHAPE})`, async ({
  browser,
}) => {
  const docId = `perf-collab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  const editors: EditorPage[] = [];

  const doc = generateLargeDocument(PERF_COLLAB_HEADINGS, {
    shape: PERF_COLLAB_SHAPE,
  });

  for (let i = 0; i < PERF_COLLAB_USERS; i++) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript(
      `window.__HOCUS_TOKEN = ${JSON.stringify(`perf-user-${i}-${docId}`)}`,
    );
    await injectPerfObserver(page);
    contexts.push(ctx);
    pages.push(page);
    editors.push(new EditorPage(page));
  }

  await editors[0].goto(docId);
  await editors[0].waitForSync();
  await editors[0].setContent(doc);
  await expect(pages[0].locator(".tiptap")).toContainText(
    "Soak Test Document",
    {
      timeout: 5000,
    },
  );
  await pages[0].waitForTimeout(2000);

  for (let i = 1; i < PERF_COLLAB_USERS; i++) {
    await editors[i].goto(docId);
    await editors[i].waitForSync();
    await expect(pages[i].locator(".tiptap")).toContainText(
      "Soak Test Document",
      { timeout: 30000 },
    );
  }

  const paragraphStride = Math.max(
    1,
    Math.floor((PERF_COLLAB_HEADINGS * 6) / PERF_COLLAB_USERS),
  );

  const typingPromises = pages.map(async (page, i) => {
    const paragraphIndex = i * paragraphStride;
    const p = page.locator(".tiptap p").nth(paragraphIndex);
    await p.click();
    await page.keyboard.type("a".repeat(100), { delay: 10 });
  });

  await Promise.all(typingPromises);

  const allStats = await Promise.all(
    pages.map((page) => collectPerfEntries(page).then(computeLatencyStats)),
  );

  for (let i = 0; i < PERF_COLLAB_USERS; i++) {
    logStats(`user ${i}`, allStats[i]);
  }

  const combinedCount = allStats.reduce((a, s) => a + s.count, 0);
  const combinedMean =
    allStats.reduce((a, s) => a + s.mean * s.count, 0) / combinedCount || 0;
  const maxP95 = Math.max(...allStats.map((s) => s.p95));
  const maxLatency = Math.max(...allStats.map((s) => s.max));
  console.log(`=== Aggregate (${PERF_COLLAB_USERS} users) ===`);
  console.log(`Total samples: ${combinedCount}`);
  console.log(`Weighted mean: ${combinedMean.toFixed(1)}ms`);
  console.log(`Max p95 across users: ${maxP95.toFixed(1)}ms`);
  console.log(`Max latency: ${maxLatency.toFixed(1)}ms`);

  for (const ctx of contexts) {
    await ctx.close();
  }
});
