import { type Browser, expect, test } from "@playwright/test";

import { generateLargeDocument } from "@/tests/helpers/document-generators";
import {
  type PerfShape,
  parsePerfHeadings,
  parsePerfShape,
} from "@/tests/helpers/perf-config";
import { writeReport } from "@/tests/helpers/report-writer";

import { EditorPage } from "./helpers/editor-page";
import {
  collectKeystrokeLatencies,
  injectKeystrokeTimer,
  median,
  percentile,
} from "./helpers/perf-observer";

const PERF_HEADINGS = parsePerfHeadings(process.env.PERF_HEADINGS, [10, 50]);
const PERF_SHAPE = parsePerfShape(process.env.PERF_SHAPE);
const PERF_ROUNDS = Number(process.env.PERF_ROUNDS ?? 3);
const PERF_CPU_THROTTLE = Number(process.env.PERF_CPU_THROTTLE ?? 4);
const PERF_MAX_REGRESSION = Number(process.env.PERF_MAX_REGRESSION ?? 0.1);

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
  headings: number;
  shape: PerfShape;
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
    await editorPage.setContent(
      generateLargeDocument(opts.headings, { shape: opts.shape }),
    );
    if (!opts.toolbar) {
      await expect(page.getByRole("toolbar")).toHaveCount(0);
    }
    const cdp = await context.newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", {
      rate: PERF_CPU_THROTTLE,
    });
    await collectKeystrokeLatencies(page);
    await page.click(".tiptap p");
    await page.keyboard.type("a".repeat(100), { delay: 10 });
    // Let queued MessageChannel callbacks drain before reading the samples.
    await page.waitForTimeout(300);
    const samples = await collectKeystrokeLatencies(page);
    expect(samples.length, "keystroke samples").toBeGreaterThan(50);
    return percentile(samples, 95);
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
      test.setTimeout(180_000);
      const p95 = { off: [] as number[], on: [] as number[] };
      for (let round = 0; round < PERF_ROUNDS; round++) {
        const order =
          round % 2 === 0 ? (["off", "on"] as const) : (["on", "off"] as const);
        for (const arm of order) {
          p95[arm].push(
            await runTrial(browser, {
              toolbar: arm === "on",
              headings: n,
              shape: PERF_SHAPE,
            }),
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
