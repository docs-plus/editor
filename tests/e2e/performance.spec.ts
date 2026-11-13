import { type Browser, expect, test } from "@playwright/test";
import type { JSONContent } from "@tiptap/core";

import { generateLargeDocument } from "@/tests/helpers/document-generators";
import { parsePerfHeadings, parsePerfShape } from "@/tests/helpers/perf-config";
import { writeReport } from "@/tests/helpers/report-writer";

import { EditorPage } from "./helpers/editor-page";
import {
  collectKeystrokeLatencies,
  injectKeystrokeTimer,
  median,
  percentile,
  waitForMainThreadIdle,
} from "./helpers/perf-observer";

const PERF_HEADINGS = parsePerfHeadings(process.env.PERF_HEADINGS, [10, 50]);
const PERF_SHAPE = parsePerfShape(process.env.PERF_SHAPE);
const PERF_ROUNDS = Number(process.env.PERF_ROUNDS ?? 7);
const PERF_CPU_THROTTLE = Number(process.env.PERF_CPU_THROTTLE ?? 4);
const PERF_MAX_REGRESSION = Number(process.env.PERF_MAX_REGRESSION ?? 0.1);
const KEYSTROKES = 220;
/** Leading keystrokes dropped from each trial: first-use JIT and layout cost. */
const WARMUP_KEYSTROKES = 20;

const perfResults: Array<{
  label: string;
  headingCount: number;
  shape: string;
  off: number;
  on: number;
  rounds: { off: number[]; on: number[] };
}> = [];

interface TrialOptions {
  toolbar: boolean;
  /** The same document for every trial of a test, so both arms type into it. */
  doc: JSONContent;
}

/** One fresh-context typing run; returns the p95 keystroke latency in ms. */
async function runTrial(browser: Browser, opts: TrialOptions): Promise<number> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    if (!opts.toolbar) {
      await page.addInitScript(() => {
        window.__TOOLBAR_OFF = true;
      });
    }
    await injectKeystrokeTimer(page);
    const editorPage = new EditorPage(page);
    await editorPage.goto();
    await editorPage.waitForSync();
    await editorPage.setContent(opts.doc);
    // Each arm waits for its own end state: the toolbar mounted or gone.
    const toolbar = page.getByRole("toolbar", {
      name: "Formatting",
      exact: true,
    });
    if (opts.toolbar) await expect(toolbar).toBeVisible();
    else await expect(page.getByRole("toolbar")).toHaveCount(0);
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", {
      rate: PERF_CPU_THROTTLE,
    });
    await page.click(".tiptap p");
    // Both arms start from a quiet page: click-triggered work has drained.
    // No forced GC here: it put the next major GC near the same keystroke
    // in every trial, a cluster of slow keys right at the p95 rank.
    await waitForMainThreadIdle(page);
    await collectKeystrokeLatencies(page);
    await page.keyboard.type("a".repeat(KEYSTROKES), { delay: 10 });
    const samples = await collectKeystrokeLatencies(page);
    expect(samples.length, "keystroke samples").toBe(KEYSTROKES);
    return percentile(samples.slice(WARMUP_KEYSTROKES), 95);
  } finally {
    await context.close();
  }
}

test.describe("typing latency", () => {
  // Serial: trials must not compete with each other for CPU.
  test.describe.configure({ mode: "serial" });

  test.afterAll(() => {
    writeReport(`perf-report-${Date.now()}.json`, {
      timestamp: new Date().toISOString(),
      shape: PERF_SHAPE,
      rounds: PERF_ROUNDS,
      cpuThrottle: PERF_CPU_THROTTLE,
      maxRegression: PERF_MAX_REGRESSION,
      results: perfResults,
    });
  });

  for (const n of PERF_HEADINGS) {
    test(`typing p95 with the toolbar stays within budget (${n} headings, ${PERF_SHAPE})`, async ({
      browser,
    }) => {
      test.setTimeout(300_000);
      // One document for every trial: the generator is random, and trials
      // typing into different documents differed more than the arms did.
      const doc = generateLargeDocument(n, { shape: PERF_SHAPE });
      // A discarded warm-up trial per arm: the first trials of a run were
      // slower (browser and server caches), which taxed whichever arm ran
      // them.
      for (const arm of ["off", "on"] as const) {
        await runTrial(browser, { toolbar: arm === "on", doc });
      }
      const p95 = { off: [] as number[], on: [] as number[] };
      for (let round = 0; round < PERF_ROUNDS; round++) {
        const order =
          round % 2 === 0 ? (["off", "on"] as const) : (["on", "off"] as const);
        for (const arm of order) {
          p95[arm].push(
            await runTrial(browser, { toolbar: arm === "on", doc }),
          );
        }
      }
      const off = median(p95.off);
      const on = median(p95.on);
      console.log(
        `perf ${n} headings: off=${p95.off.map((v) => v.toFixed(1))} on=${p95.on.map((v) => v.toFixed(1))} median off=${off.toFixed(1)} on=${on.toFixed(1)}`,
      );
      perfResults.push({
        label: `${n} headings (${PERF_SHAPE})`,
        headingCount: n,
        shape: PERF_SHAPE,
        off,
        on,
        rounds: p95,
      });
      expect(
        on,
        `toolbar-on p95 ${on.toFixed(1)} ms vs off ${off.toFixed(1)} ms`,
      ).toBeLessThanOrEqual(off * (1 + PERF_MAX_REGRESSION));
    });
  }
});
