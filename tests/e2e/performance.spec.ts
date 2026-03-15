import { test } from "@playwright/test";
import { EditorPage } from "./helpers/editor-page";
import {
  collectPerfEntries,
  computeLatencyStats,
  injectPerfObserver,
} from "./helpers/perf-observer";

test.describe("performance baselines", () => {
  test("typing latency with 10 headings", async ({ page }) => {
    await injectPerfObserver(page);

    const editorPage = new EditorPage(page);
    await editorPage.goto();
    await editorPage.waitForSync();

    const headings = [{ level: 1, text: "Performance Test" }];
    for (let i = 0; i < 9; i++) {
      headings.push({ level: 2, text: `Section ${i + 1}` });
    }
    await editorPage.buildDocument(headings);

    await page.click(".tiptap");
    await page.keyboard.type("a".repeat(100), { delay: 10 });

    const entries = await collectPerfEntries(page);
    const stats = computeLatencyStats(entries);

    console.log("=== Performance: 10 headings ===");
    console.log(`Samples: ${stats.count}`);
    console.log(`p50: ${stats.p50.toFixed(1)}ms`);
    console.log(`p95: ${stats.p95.toFixed(1)}ms`);
    console.log(`Mean: ${stats.mean.toFixed(1)}ms`);
    console.log(`Max: ${stats.max.toFixed(1)}ms`);
  });

  test("typing latency with 50 headings", async ({ page }) => {
    await injectPerfObserver(page);

    const editorPage = new EditorPage(page);
    await editorPage.goto();
    await editorPage.waitForSync();

    const content = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1, "data-toc-id": "perf-0" },
          content: [{ type: "text", text: "Performance Test 50" }],
        },
        ...Array.from({ length: 49 }, (_, i) => ({
          type: "heading",
          attrs: { level: 2, "data-toc-id": `perf-${i + 1}` },
          content: [{ type: "text", text: `Section ${i + 1}` }],
        })),
      ],
    };
    await editorPage.setContent(content);

    await page.click(".tiptap");
    await page.keyboard.type("a".repeat(100), { delay: 10 });

    const entries = await collectPerfEntries(page);
    const stats = computeLatencyStats(entries);

    console.log("=== Performance: 50 headings ===");
    console.log(`Samples: ${stats.count}`);
    console.log(`p50: ${stats.p50.toFixed(1)}ms`);
    console.log(`p95: ${stats.p95.toFixed(1)}ms`);
    console.log(`Mean: ${stats.mean.toFixed(1)}ms`);
    console.log(`Max: ${stats.max.toFixed(1)}ms`);
  });
});
