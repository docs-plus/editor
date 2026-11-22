import { type Browser, expect, type Page, test } from "@playwright/test";

import { generateLargeDocument } from "@/tests/helpers/document-generators";

import { EditorPage } from "./helpers/editor-page";
import {
  collectKeystrokeLatencies,
  injectKeystrokeTimer,
  median,
  percentile,
  waitForMainThreadIdle,
} from "./helpers/perf-observer";

/*
 * Page preferences apply through `<html>` attributes and CSS variables
 * (preferences design §5.15 `perf`): a text size or spacing change on a
 * large document lays out once and runs no editor transaction, so
 * HeadingScale rebuilds nothing. The design names a 1,000-heading
 * fixture; the server refuses that one (2 MiB cap), so this uses 500.
 */

/**
 * The 500-heading document (about 1.2 MB, the largest the server keeps
 * under its 2 MiB cap; the typing suite uses the same generator).
 */
async function openLarge(page: Page, look: "new" | "classic") {
  await page.addInitScript((look) => {
    if (!localStorage.getItem("tinydocy-look")) {
      localStorage.setItem("tinydocy-look", look);
    }
  }, look);
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForSync();
  await editor.setContent(generateLargeDocument(500));
  await editor.expectSavedToServer();
  // The preferences runtime (and its dev hook) loads once the page idles.
  await page.waitForFunction(() => window.__tinydocyPrefs !== undefined);
  return editor;
}

const CHANGES = [
  () => window.__tinydocyPrefs?.setPageKnob("size", 20),
  () => window.__tinydocyPrefs?.setPageKnob("spacing", "relaxed"),
  () => window.__tinydocyPrefs?.setPageKnob("size", 24),
];

/**
 * Layout passes per change, counted over the change's frame and the next
 * one, with no editor transaction in between.
 * - The engine itself costs one layout: measured with every block
 *   rendered (`content-visibility: visible`).
 * - On the real page, `content-visibility: auto` (off-screen blocks,
 *   `document-editor.scss`) adds its relevance pass after any geometry
 *   change, in the same frame; a theme flip, which moves nothing, stays
 *   at one.
 */
for (const [name, renderAll, perChange] of [
  ["the engine lays out once per change", true, 1],
  ["with off-screen blocks skipped, at most one more relevance pass", false, 2],
] as const) {
  test(`page preferences: ${name}, no transaction`, async ({ page }) => {
    test.setTimeout(120_000);
    await openLarge(page, "new");
    if (renderAll) {
      await page.addStyleTag({
        content: "* { content-visibility: visible !important; }",
      });
    }
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const layouts = async () => {
      const { metrics } = await cdp.send("Performance.getMetrics");
      return (
        metrics.find((metric) => metric.name === "LayoutCount")?.value ?? 0
      );
    };
    await page.evaluate(() => {
      const win = window as Window & { __transactions?: number };
      win.__transactions = 0;
      window.__tiptap_editor?.on("transaction", () => {
        win.__transactions = (win.__transactions ?? 0) + 1;
      });
    });
    await waitForMainThreadIdle(page);

    for (const change of CHANGES) {
      const before = await layouts();
      await page.evaluate(change);
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await waitForMainThreadIdle(page);
      const passes = (await layouts()) - before;
      // The relevance pass is Chromium's; never more than one of it.
      expect(passes).toBeGreaterThanOrEqual(1);
      expect(passes).toBeLessThanOrEqual(perChange);
    }
    expect(
      await page.evaluate(
        () => (window as Window & { __transactions?: number }).__transactions,
      ),
    ).toBe(0);
  });
}

/** One fresh-context typing run on the large document; p95 in ms. */
async function typingP95(
  browser: Browser,
  look: "new" | "classic",
): Promise<number> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await injectKeystrokeTimer(page);
    await openLarge(page, look);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    await page.click(".tiptap p");
    await waitForMainThreadIdle(page);
    await collectKeystrokeLatencies(page);
    await page.keyboard.type("a".repeat(220), { delay: 10 });
    const samples = await collectKeystrokeLatencies(page);
    return percentile(samples.slice(20), 95);
  } finally {
    await context.close();
  }
}

// Evidence for the PR, not a CI gate (timing comparisons belong to the
// typing-latency suite): `PAGE_PERF_TYPING=1`.
test("typing in the Default page costs the same as in classic", async ({
  browser,
}) => {
  test.skip(!process.env.PAGE_PERF_TYPING, "set PAGE_PERF_TYPING=1");
  test.setTimeout(600_000);
  const p95 = { classic: [] as number[], new: [] as number[] };
  await typingP95(browser, "classic");
  await typingP95(browser, "new");
  for (let round = 0; round < 5; round++) {
    const order =
      round % 2 === 0
        ? (["classic", "new"] as const)
        : (["new", "classic"] as const);
    for (const look of order) p95[look].push(await typingP95(browser, look));
  }
  console.log(
    `page-engine typing p95 classic=${p95.classic.map((v) => v.toFixed(1))} default=${p95.new.map((v) => v.toFixed(1))} median classic=${median(p95.classic).toFixed(1)} default=${median(p95.new).toFixed(1)}`,
  );
  expect(median(p95.new)).toBeLessThanOrEqual(median(p95.classic) * 1.1 + 1);
});
