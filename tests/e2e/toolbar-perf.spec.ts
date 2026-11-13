import { expect, type Page, test } from "@playwright/test";

import { TOOLBAR_SETTLE_MS } from "@/hooks/use-tiptap-editor";
import { generateLargeDocument } from "@/tests/helpers/document-generators";
import { writeReport } from "@/tests/helpers/report-writer";

import { EditorPage } from "./helpers/editor-page";
import { percentile, waitForMainThreadIdle } from "./helpers/perf-observer";

/**
 * CDP CPU throttle for both arms of the arrow p95 (1 = off), to reproduce a
 * slow CI runner locally. The ceilings are absolute, so a throttled run is
 * informational: it scales the toolbar's real cost too.
 */
const CPU_THROTTLE = Number(process.env.TOOLBAR_PERF_CPU_THROTTLE ?? 1);
/**
 * Tall enough that the 60-key walk never scrolls. A scroll frame lays out
 * the blocks it reveals and costs several times a normal key; at 720 px the
 * walk scrolled about five times, putting those frames right at the p95
 * rank, so one more or one fewer moved an arm's p95 by hundreds of ms.
 */
const WALK_VIEWPORT = { width: 1280, height: 4000 };
/** Measured rounds per arm of the arrow p95, interleaved on and off. */
const ARROW_ROUNDS = 3;
/** Keys of the discarded warm-up round on each arm. */
const WARMUP_ARROWS = 20;
const WARMUP_SHIFTS = 10;

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
    browser,
  }) => {
    test.setTimeout(300_000);
    // One document for both arms: the generator is random, and arms walking
    // different documents differ by more than the toolbar does.
    const doc = generateLargeDocument(500, {
      shape: "mixed",
      richContent: false,
    });

    /** A fresh context with the document loaded and the key probe on. */
    const openArm = async (toolbar: boolean) => {
      const context = await browser.newContext({ viewport: WALK_VIEWPORT });
      const page = await context.newPage();
      // Without the toolbar: the same keys cost the editor alone.
      if (!toolbar) await page.addInitScript("window.__TOOLBAR_OFF = true");
      const editorPage = new EditorPage(page);
      await editorPage.goto();
      await editorPage.waitForSync();
      await editorPage.setContent(doc);
      if (CPU_THROTTLE > 1) {
        const cdp = await context.newCDPSession(page);
        await cdp.send("Emulation.setCPUThrottlingRate", {
          rate: CPU_THROTTLE,
        });
      }
      if (toolbar) {
        await expect(
          page.getByRole("toolbar", { name: "Formatting", exact: true }),
        ).toBeVisible();
      } else {
        await expect(page.getByRole("toolbar")).toHaveCount(0);
      }
      // Keydown to the first task after the next frame: the key's own
      // work, the toolbar's and the paint. One sample per press: the
      // modifier's own keydown (Shift of Shift+ArrowLeft) is skipped.
      await page.evaluate(() => {
        const w = window as unknown as { __keyMs: number[] };
        w.__keyMs = [];
        const modifiers = new Set(["Shift", "Control", "Meta", "Alt"]);
        window.addEventListener(
          "keydown",
          (event) => {
            if (modifiers.has(event.key)) return;
            const start = performance.now();
            requestAnimationFrame(() =>
              setTimeout(() => w.__keyMs.push(performance.now() - start), 0),
            );
          },
          true,
        );
      });
      return { context, page };
    };

    /** Presses each key once its predecessor has painted; returns the ms. */
    const timeKeys = async (page: Page, keys: string[]) => {
      await page.evaluate(() => {
        (window as unknown as { __keyMs: number[] }).__keyMs = [];
      });
      for (const [i, key] of keys.entries()) {
        await page.keyboard.press(key);
        await page.waitForFunction(
          (count) =>
            (window as unknown as { __keyMs: number[] }).__keyMs.length >=
            count,
          i + 1,
          { polling: "raf" },
        );
      }
      return page.evaluate(
        () => (window as unknown as { __keyMs: number[] }).__keyMs,
      );
    };

    /**
     * One round from the same start: down through headings, paragraphs and
     * code (the slot swaps often), then Shift+Arrow on a select-all.
     */
    const scroller = (page: Page) => page.locator(".document-editor-wrapper");
    const round = async (page: Page, arrows: number, shifts: number) => {
      await scroller(page).evaluate((el) => el.scrollTo(0, 0));
      await page.locator(".tiptap h1").first().click();
      await expect(page.locator(".tiptap")).toBeFocused();
      await waitForMainThreadIdle(page);
      const arrow = await timeKeys(page, Array(arrows).fill("ArrowDown"));
      expect(
        await scroller(page).evaluate((el) => el.scrollTop),
        "the arrow walk stays on one screen",
      ).toBe(0);
      await page.keyboard.press("ControlOrMeta+a");
      await waitForMainThreadIdle(page);
      const shift = await timeKeys(page, Array(shifts).fill("Shift+ArrowLeft"));
      return { arrow, shift };
    };

    const arms = { on: await openArm(true), off: await openArm(false) };
    const samples = {
      on: { arrow: [] as number[], shift: [] as number[] },
      off: { arrow: [] as number[], shift: [] as number[] },
    };
    try {
      // Warm-up pass on both arms (first-use JIT, layout and chunk work),
      // then interleaved rounds that alternate which arm goes first.
      for (const arm of ["on", "off"] as const) {
        await round(arms[arm].page, WARMUP_ARROWS, WARMUP_SHIFTS);
      }
      for (let r = 0; r < ARROW_ROUNDS; r++) {
        const order =
          r % 2 === 0 ? (["on", "off"] as const) : (["off", "on"] as const);
        for (const arm of order) {
          const { arrow, shift } = await round(arms[arm].page, 60, 30);
          samples[arm].arrow.push(...arrow);
          samples[arm].shift.push(...shift);
        }
      }
    } finally {
      await arms.on.context.close();
      await arms.off.context.close();
    }
    const withToolbar = {
      arrow: percentile(samples.on.arrow, 95),
      shift: percentile(samples.on.shift, 95),
    };
    const withoutToolbar = {
      arrow: percentile(samples.off.arrow, 95),
      shift: percentile(samples.off.shift, 95),
    };
    const arrowDelta = withToolbar.arrow - withoutToolbar.arrow;
    const shiftDelta = withToolbar.shift - withoutToolbar.shift;
    console.log(
      `500 headings p95 (dev build): arrow ${withToolbar.arrow.toFixed(1)}ms vs ${withoutToolbar.arrow.toFixed(1)}ms without toolbar; shift+arrow on select-all ${withToolbar.shift.toFixed(1)}ms vs ${withoutToolbar.shift.toFixed(1)}ms`,
    );
    writeReport(`toolbar-arrow-p95-${Date.now()}.json`, {
      timestamp: new Date().toISOString(),
      headings: 500,
      rounds: ARROW_ROUNDS,
      withToolbar,
      withoutToolbar,
      samples,
    });
    // Loose ceilings on the toolbar's share: a regression to a full doc
    // walk per mark or a layout pass per slot swap lands far above them.
    expect(arrowDelta).toBeLessThanOrEqual(50);
    expect(shiftDelta).toBeLessThanOrEqual(50);
  });
});
