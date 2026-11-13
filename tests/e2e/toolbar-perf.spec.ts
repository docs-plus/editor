import { expect, type Page, test } from "@playwright/test";

import { TOOLBAR_SETTLE_MS } from "@/hooks/use-tiptap-editor";
import { generateLargeDocument } from "@/tests/helpers/document-generators";
import { writeReport } from "@/tests/helpers/report-writer";

import { EditorPage } from "./helpers/editor-page";

/**
 * Toolbar timing budgets on a 500-heading document. They compare
 * milliseconds, so they run in the one-worker `perf` project (moved out of
 * toolbar-row.spec.ts, where three parallel workers made the arrow p95
 * comparison noisy in CI).
 */
test.describe("catch-up render budget", () => {
  test("a typing burst in a 500-heading doc keeps toolbar renders bounded", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const editorPage = new EditorPage(page);
    await editorPage.goto();
    await editorPage.waitForSync();
    // Plain content keeps 500 headings under the dev server's size cap.
    await editorPage.setContent(
      generateLargeDocument(500, { shape: "mixed", richContent: false }),
    );
    await page.locator(".tiptap h1").first().click();
    await expect(page.locator(".tiptap")).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      window.__toolbarRenderMs = [];
      window.__toolbarCommits = 0;
    });
    const start = Date.now();
    // The input rule turns the paragraph into a heading mid-burst, so the
    // style menu, the slot and the section tools all have to catch up.
    await page.keyboard.type(`## ${"a".repeat(147)}`, { delay: 20 });
    const burstMs = Date.now() - start;
    await page.waitForTimeout(TOOLBAR_SETTLE_MS + 200);
    const renders = await page.evaluate(() => window.__toolbarRenderMs ?? []);
    const max = Math.max(0, ...renders);
    const sum = renders.reduce((a, b) => a + b, 0);
    console.log(
      `toolbar catch-up: commits=${renders.length} max=${max.toFixed(1)}ms sum=${sum.toFixed(1)}ms burst=${burstMs}ms`,
    );
    writeReport(`toolbar-catch-up-${Date.now()}.json`, {
      timestamp: new Date().toISOString(),
      headings: 500,
      keystrokes: 150,
      burstMs,
      commits: renders.length,
      maxMs: max,
      sumMs: sum,
      renders,
    });
    expect(renders.length).toBeGreaterThanOrEqual(1); // the probe is wired
    // Leaf subscriptions: only controls whose view changed re-render, so a
    // catch-up stays far below a long task (50 ms) even in a dev build. The
    // commit count per settle window is asserted in toolbar.spec.ts.
    expect(max).toBeLessThanOrEqual(50);
  });

  test("arrow and Shift+Arrow p95 in a 500-heading doc", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    const measure = async (target: Page) => {
      const editorPage = new EditorPage(target);
      await editorPage.goto();
      await editorPage.waitForSync();
      await editorPage.setContent(
        generateLargeDocument(500, { shape: "mixed", richContent: false }),
      );
      await target.locator(".tiptap h1").first().click();
      await expect(target.locator(".tiptap")).toBeFocused();
      await target.waitForTimeout(500);
      // Keydown to the first task after the next frame: the key's own
      // work, the toolbar's and the paint.
      await target.evaluate(() => {
        const w = window as unknown as { __keyMs: number[] };
        w.__keyMs = [];
        window.addEventListener(
          "keydown",
          () => {
            const start = performance.now();
            requestAnimationFrame(() =>
              setTimeout(() => w.__keyMs.push(performance.now() - start), 0),
            );
          },
          true,
        );
      });
      const p95 = async (keys: string[]) => {
        await target.evaluate(() => {
          (window as unknown as { __keyMs: number[] }).__keyMs = [];
        });
        for (const key of keys) {
          await target.keyboard.press(key);
          await target.waitForTimeout(30);
        }
        const ms = await target.evaluate(
          () => (window as unknown as { __keyMs: number[] }).__keyMs,
        );
        const sorted = [...ms].sort((a, b) => a - b);
        return sorted[
          Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
        ];
      };
      // Down through headings, paragraphs and code: the slot swaps often.
      const arrow = await p95(Array(60).fill("ArrowDown"));
      await target.keyboard.press("ControlOrMeta+a");
      await target.waitForTimeout(300);
      const shift = await p95(Array(30).fill("Shift+ArrowLeft"));
      return { arrow, shift };
    };
    const withToolbar = await measure(page);
    // The same keys with the toolbar unmounted: the editor's own cost.
    const bare = await context.newPage();
    await bare.addInitScript("window.__TOOLBAR_OFF = true");
    const withoutToolbar = await measure(bare);
    await bare.close();
    const arrowDelta = withToolbar.arrow - withoutToolbar.arrow;
    const shiftDelta = withToolbar.shift - withoutToolbar.shift;
    console.log(
      `500 headings p95 (dev build): arrow ${withToolbar.arrow.toFixed(1)}ms vs ${withoutToolbar.arrow.toFixed(1)}ms without toolbar; shift+arrow on select-all ${withToolbar.shift.toFixed(1)}ms vs ${withoutToolbar.shift.toFixed(1)}ms`,
    );
    writeReport(`toolbar-arrow-p95-${Date.now()}.json`, {
      timestamp: new Date().toISOString(),
      headings: 500,
      withToolbar,
      withoutToolbar,
    });
    // Loose ceilings on the toolbar's share: a regression to a full doc
    // walk per mark or a layout pass per slot swap lands far above them.
    expect(arrowDelta).toBeLessThanOrEqual(50);
    expect(shiftDelta).toBeLessThanOrEqual(50);
  });
});
