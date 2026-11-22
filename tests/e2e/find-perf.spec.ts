import { type Browser, expect, type Page, test } from "@playwright/test";
import type { JSONContent } from "@tiptap/core";

import { writeReport } from "@/tests/helpers/report-writer";

import { EditorPage } from "./helpers/editor-page";
import { percentile, waitForMainThreadIdle } from "./helpers/perf-observer";

/**
 * Typing with Find open (P2.11, details spec E1): real key presses, each
 * timed from keydown to the first task after the next frame, so the
 * keystroke's own work, Find's `transaction` listener, the painter's
 * `MutationObserver` and its frame work (range rebuilds), the browser's
 * update of every live Range, and the paint are all included. Each arm
 * types the same keys into the same block, with Find closed and open,
 * alternating rounds; the budget is on the difference.
 *
 * Runs in the `perf` project (one worker, after the parallel suite).
 */

const BAR = "[data-find-bar]";
const STATUS = `${BAR} [role="status"]`;
const KEYS_PER_ROUND = Number(process.env.FIND_PERF_KEYS ?? 30);
const ROUNDS = Number(process.env.FIND_PERF_ROUNDS ?? 3);
/** Most Find may add to the median keystroke, in ms (both arms unthrottled). */
const MAX_MEDIAN_DELTA_MS = Number(process.env.FIND_PERF_MAX_MEDIAN_MS ?? 4);
/** Most Find may add to the p95 keystroke: one frame. */
const MAX_P95_DELTA_MS = Number(process.env.FIND_PERF_MAX_P95_MS ?? 16);

const heading = (text: string, level = 2): JSONContent => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});
const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

/** 1,000 sections: 2,000 hits spread over 3,000 blocks. */
function sectionsDoc(count: number): JSONContent {
  const content: JSONContent[] = [heading("Find perf", 1)];
  for (let n = 1; n <= count; n++) {
    content.push(
      heading(`Section ${n} needle`),
      paragraph(`Body ${n} has a needle and a pin.`),
      paragraph(`More text for section ${n}.`),
    );
  }
  return { type: "doc", content };
}

/** One paragraph holding `hits` hits, typed into at its start. */
function longBlockDoc(hits: number): JSONContent {
  return {
    type: "doc",
    content: [
      heading("Find perf", 1),
      paragraph("Typing goes here. "),
      paragraph("needle ".repeat(hits)),
    ],
  };
}

interface Case {
  name: string;
  doc: JSONContent;
  /** Hit count the status shows once the query is typed. */
  total: string;
  /** Block (top-level index) typed into, and the offset inside it. */
  block: number;
  offset: number;
}

const CASES: Case[] = [
  {
    name: "1,000 headings, 2,000 hits",
    doc: sectionsDoc(1_000),
    total: "2,000",
    block: 2,
    offset: 4,
  },
  {
    // The hits share the typed block's text node, so every live range
    // shifts with each key.
    name: "one block with 5,000 hits",
    doc: longBlockDoc(5_000),
    total: "5,000",
    block: 2,
    offset: 3,
  },
  {
    name: "one block at the 10,000-hit cap",
    doc: longBlockDoc(10_000),
    total: "10,000+",
    block: 2,
    offset: 3,
  },
];

type ProbeWindow = Window & { __keyMs: number[] };

async function openCase(browser: Browser, c: Case) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const editorPage = new EditorPage(page);
  await editorPage.goto();
  await editorPage.waitForSync();
  await editorPage.setContent(c.doc);
  await editorPage.expectSavedToServer();
  await page.evaluate(() => {
    const w = window as unknown as ProbeWindow;
    w.__keyMs = [];
    window.addEventListener(
      "keydown",
      (event) => {
        if (!(event.target as Element).closest?.(".ProseMirror")) return;
        const start = performance.now();
        requestAnimationFrame(() =>
          setTimeout(() => w.__keyMs.push(performance.now() - start), 0),
        );
      },
      true,
    );
  });
  return { context, page };
}

/** Puts the caret in the case's block and focuses the editor. */
async function placeCaret(page: Page, c: Case) {
  await page.evaluate(
    ({ block, offset }) => {
      const editor = window.__tiptap_editor;
      if (!editor) throw new Error("no editor");
      let pos = 0;
      for (let i = 0; i < block; i++) pos += editor.state.doc.child(i).nodeSize;
      editor.commands.setTextSelection(pos + 1 + offset);
      editor.view.focus();
    },
    { block: c.block, offset: c.offset },
  );
}

/** Types `count` keys, each once its predecessor has painted; returns ms. */
async function timeTyping(page: Page, count: number): Promise<number[]> {
  await waitForMainThreadIdle(page);
  await page.evaluate(() => {
    (window as unknown as ProbeWindow).__keyMs = [];
  });
  for (let i = 0; i < count; i++) {
    // "z" and Backspace: the block's text, and its hits, stay the same.
    await page.keyboard.press(i % 2 === 0 ? "z" : "Backspace");
    await page.waitForFunction(
      (n) => (window as unknown as ProbeWindow).__keyMs.length >= n,
      i + 1,
      { polling: "raf" },
    );
  }
  return page.evaluate(() => (window as unknown as ProbeWindow).__keyMs);
}

test.describe("Find: typing cost with the bar open", () => {
  test.describe.configure({ mode: "serial" });

  for (const c of CASES) {
    test(c.name, async ({ browser }) => {
      test.setTimeout(300_000);
      const { context, page } = await openCase(browser, c);
      const samples = { closed: [] as number[], open: [] as number[] };
      try {
        // First ⌘F types the query; later rounds reopen on it.
        let typedQuery = false;
        const round = async (arm: "closed" | "open", keep: boolean) => {
          if (arm === "open") {
            await page.keyboard.press("ControlOrMeta+f");
            if (!typedQuery) {
              await page.keyboard.type("needle");
              typedQuery = true;
            }
            await expect(page.locator(STATUS)).toContainText(`of ${c.total}`);
          } else {
            await expect(page.locator(BAR)).toHaveCount(0);
          }
          await placeCaret(page, c);
          const ms = await timeTyping(page, KEYS_PER_ROUND);
          if (keep) samples[arm].push(...ms);
          if (arm === "open") {
            await page
              .getByRole("button", { name: "Close find", exact: true })
              .click();
            await expect(page.locator(BAR)).toHaveCount(0);
          }
        };
        // Warm-up (first-use JIT, the bar's chunk), then alternating rounds.
        await round("closed", false);
        await round("open", false);
        for (let r = 0; r < ROUNDS; r++) {
          const order =
            r % 2 === 0
              ? (["open", "closed"] as const)
              : (["closed", "open"] as const);
          for (const arm of order) await round(arm, true);
        }
      } finally {
        await context.close();
      }
      const stats = {
        closed: {
          median: percentile(samples.closed, 50),
          p95: percentile(samples.closed, 95),
        },
        open: {
          median: percentile(samples.open, 50),
          p95: percentile(samples.open, 95),
        },
      };
      const medianDelta = stats.open.median - stats.closed.median;
      const p95Delta = stats.open.p95 - stats.closed.p95;
      const summary = `${c.name}: key to paint median ${stats.closed.median.toFixed(1)} → ${stats.open.median.toFixed(1)} ms, p95 ${stats.closed.p95.toFixed(1)} → ${stats.open.p95.toFixed(1)} ms (closed → open)`;
      console.log(summary);
      test.info().annotations.push({ type: "perf", description: summary });
      writeReport(`find-perf-${Date.now()}.json`, {
        timestamp: new Date().toISOString(),
        case: c.name,
        rounds: ROUNDS,
        keysPerRound: KEYS_PER_ROUND,
        stats,
        samples,
      });
      expect(medianDelta, summary).toBeLessThanOrEqual(MAX_MEDIAN_DELTA_MS);
      expect(p95Delta, summary).toBeLessThanOrEqual(MAX_P95_DELTA_MS);
    });
  }
});
