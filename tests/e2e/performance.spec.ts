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
/**
 * Rounds added when the first `PERF_ROUNDS` look over budget; the verdict
 * then uses every round. A clean run that drew a noisy sample gets a second
 * look; a real regression stays over the budget with twice the samples.
 */
const PERF_EXTRA_ROUNDS = Number(process.env.PERF_EXTRA_ROUNDS ?? PERF_ROUNDS);
const PERF_CPU_THROTTLE = Number(process.env.PERF_CPU_THROTTLE ?? 4);
const PERF_MAX_REGRESSION = Number(process.env.PERF_MAX_REGRESSION ?? 0.1);
/**
 * The comments case (comments design §8, "Typing"): off by default while
 * comments are dark on the web. `PERF_COMMENTS=1` runs it; the page mounts
 * comments through a dev-only hook (`comments-test-hooks.ts`), so it needs
 * `next dev`, like the rest of this project.
 */
const PERF_COMMENTS = process.env.PERF_COMMENTS === "1";
const PERF_COMMENTS_HEADINGS = Number(
  process.env.PERF_COMMENTS_HEADINGS ?? 1000,
);
const PERF_COMMENTS_THREADS = Number(process.env.PERF_COMMENTS_THREADS ?? 300);
const PERF_COMMENTS_MAX_REGRESSION = Number(
  process.env.PERF_COMMENTS_MAX_REGRESSION ?? 0.05,
);
const KEYSTROKES = 220;
/** Leading keystrokes dropped from each trial: first-use JIT and layout cost. */
const WARMUP_KEYSTROKES = 20;

const perfResults: Array<{
  label: string;
  headingCount: number;
  shape: string;
  off: number;
  on: number;
  /** Median of the per-round on/off ratios: the verdict. */
  ratio: number;
  /** Rounds actually run: PERF_ROUNDS, plus PERF_EXTRA_ROUNDS if it was close. */
  roundsRun: number;
  rounds: { off: number[]; on: number[] };
}> = [];

type ArmP95 = { off: number[]; on: number[] };

/**
 * The verdict statistic: each round types both arms back to back, so the
 * ratio within a round cancels the runner's drift across rounds (CI history:
 * sd 0.037 against 0.051 for the ratio of the two arms' medians).
 */
function pairedRatio(p95: ArmP95): number {
  return median(p95.on.map((on, round) => on / p95.off[round]));
}

interface TrialOptions {
  toolbar: boolean;
  /** The same document for every trial of a test, so both arms type into it. */
  doc: JSONContent;
  /** Mount comments and seed this many threads first (the comments case). */
  threads?: number;
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
    if (opts.threads !== undefined) {
      await page.addInitScript(() => {
        window.__COMMENTS_PERF = true;
      });
    }
    await injectKeystrokeTimer(page);
    const editorPage = new EditorPage(page);
    await editorPage.goto();
    await editorPage.waitForSync();
    await editorPage.setContent(opts.doc);
    // A refused document turns read-only and would record no keystrokes.
    await editorPage.expectSavedToServer();
    // Each arm waits for its own end state: the toolbar mounted or gone.
    const toolbar = page.getByRole("toolbar", {
      name: "Formatting",
      exact: true,
    });
    if (opts.toolbar) await expect(toolbar).toBeVisible();
    else await expect(page.getByRole("toolbar")).toHaveCount(0);
    if (opts.threads !== undefined) {
      // Both arms load the controller; only the threads differ.
      await page.waitForFunction(() => window.__comments !== undefined);
      expect(await page.evaluate(() => window.__comments?.ready())).toBe(true);
      const made = await page.evaluate(
        (count) => window.__comments?.seed(count) ?? 0,
        opts.threads,
      );
      expect(made, "threads seeded").toBe(opts.threads);
      await editorPage.expectSavedToServer();
    }
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
    // The keys reached the server too: a refusal mid-run names its cause.
    await editorPage.expectSavedToServer();
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
      configuredRounds: PERF_ROUNDS,
      configuredExtraRounds: PERF_EXTRA_ROUNDS,
      cpuThrottle: PERF_CPU_THROTTLE,
      maxRegression: PERF_MAX_REGRESSION,
      results: perfResults,
    });
  });

  for (const n of PERF_HEADINGS) {
    test(`typing p95 with the toolbar stays within budget (${n} headings, ${PERF_SHAPE})`, async ({
      browser,
    }) => {
      // Up to PERF_ROUNDS + PERF_EXTRA_ROUNDS rounds of two trials each.
      test.setTimeout(600_000);
      // One document for every trial: the generator is random, and trials
      // typing into different documents differed more than the arms did.
      const doc = generateLargeDocument(n, { shape: PERF_SHAPE });
      // A discarded warm-up trial per arm: the first trials of a run were
      // slower (browser and server caches), which taxed whichever arm ran
      // them.
      for (const arm of ["off", "on"] as const) {
        await runTrial(browser, { toolbar: arm === "on", doc });
      }
      const p95: ArmP95 = { off: [], on: [] };
      const runRounds = async (count: number) => {
        for (let i = 0; i < count; i++) {
          // Alternate which arm goes first, across both batches.
          const order =
            p95.off.length % 2 === 0
              ? (["off", "on"] as const)
              : (["on", "off"] as const);
          for (const arm of order) {
            p95[arm].push(
              await runTrial(browser, { toolbar: arm === "on", doc }),
            );
          }
        }
      };
      const budget = 1 + PERF_MAX_REGRESSION;
      await runRounds(PERF_ROUNDS);
      if (pairedRatio(p95) > budget && PERF_EXTRA_ROUNDS > 0) {
        console.log(
          `perf ${n} headings: ratio ${pairedRatio(p95).toFixed(3)} over ${budget} after ${PERF_ROUNDS} rounds; running ${PERF_EXTRA_ROUNDS} more`,
        );
        await runRounds(PERF_EXTRA_ROUNDS);
      }
      const off = median(p95.off);
      const on = median(p95.on);
      const ratio = pairedRatio(p95);
      console.log(
        `perf ${n} headings: off=${p95.off.map((v) => v.toFixed(1))} on=${p95.on.map((v) => v.toFixed(1))} median off=${off.toFixed(1)} on=${on.toFixed(1)} paired ratio=${ratio.toFixed(3)}`,
      );
      perfResults.push({
        label: `${n} headings (${PERF_SHAPE})`,
        headingCount: n,
        shape: PERF_SHAPE,
        off,
        on,
        ratio,
        roundsRun: p95.on.length,
        rounds: p95,
      });
      expect(
        ratio,
        `toolbar-on vs off p95, median of ${p95.on.length} paired rounds (medians ${on.toFixed(1)} vs ${off.toFixed(1)} ms)`,
      ).toBeLessThanOrEqual(budget);
    });
  }
});

test.describe("typing latency with comments", () => {
  test.describe.configure({ mode: "serial" });
  test.skip(
    !PERF_COMMENTS,
    "comments are dark on the web; PERF_COMMENTS=1 runs this case",
  );

  test(`typing p95 with ${PERF_COMMENTS_THREADS} threads stays within ${PERF_COMMENTS_MAX_REGRESSION * 100}% (${PERF_COMMENTS_HEADINGS} headings, ${PERF_SHAPE})`, async ({
    browser,
  }) => {
    test.setTimeout(1_200_000);
    const doc = generateLargeDocument(PERF_COMMENTS_HEADINGS, {
      shape: PERF_SHAPE,
    });
    // "off": comments mounted, no threads; "on": the same with threads.
    const trial = (arm: "off" | "on") =>
      runTrial(browser, {
        toolbar: true,
        doc,
        threads: arm === "on" ? PERF_COMMENTS_THREADS : 0,
      });
    for (const arm of ["off", "on"] as const) await trial(arm);
    const p95: ArmP95 = { off: [], on: [] };
    for (let round = 0; round < PERF_ROUNDS; round++) {
      const order =
        round % 2 === 0 ? (["off", "on"] as const) : (["on", "off"] as const);
      for (const arm of order) p95[arm].push(await trial(arm));
    }
    const ratio = pairedRatio(p95);
    console.log(
      `perf comments: off=${p95.off.map((v) => v.toFixed(1))} on=${p95.on.map((v) => v.toFixed(1))} paired ratio=${ratio.toFixed(3)}`,
    );
    expect(
      ratio,
      `${PERF_COMMENTS_THREADS} threads vs none, typing p95, median of ${p95.on.length} paired rounds`,
    ).toBeLessThanOrEqual(1 + PERF_COMMENTS_MAX_REGRESSION);
  });
});
