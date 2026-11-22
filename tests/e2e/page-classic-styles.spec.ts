import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { preparePixelPage } from "./helpers/page-fixture";

/**
 * Classic page state (P2.9c-1): a returning browser must get `main`'s
 * document metrics. Loads the page fixture as a returning visitor and
 * compares computed styles and block heights with a snapshot taken from
 * `main`. Regenerate the snapshot against a `main` server (never against
 * the branch):
 *
 *   GENERATE_CLASSIC_SNAPSHOT=1 CI= E2E_BASE_URL=http://localhost:3190 \
 *     bun playwright test tests/e2e/page-classic-styles.spec.ts --project=chromium
 */

const SNAPSHOT_PATH = path.join(
  __dirname,
  "fixtures",
  "page-classic-styles.json",
);
const GENERATE = process.env.GENERATE_CLASSIC_SNAPSHOT === "1";

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900, mobile: false },
  { name: "phone", width: 375, height: 812, mobile: true },
] as const;

const TEXT_PROPERTIES = [
  "font-size",
  "line-height",
  "margin-top",
  "margin-bottom",
  "font-family",
  "letter-spacing",
];

/** Each probe: a label, a selector, which match, and extra properties. */
const PROBES: Array<{
  label: string;
  selector: string;
  index?: number;
  extra?: string[];
}> = [
  {
    label: "card",
    selector: ".document-editor-content",
    extra: ["max-width", "width"],
  },
  { label: "tiptap", selector: ".tiptap" },
  { label: "p first", selector: ".tiptap > p", index: 0 },
  { label: "p later", selector: ".tiptap > p", index: 2 },
  { label: "li p first-child", selector: ".tiptap li > p:first-child" },
  { label: "li p second", selector: ".tiptap li > p:nth-child(2)" },
  { label: "td p", selector: ".tiptap td p" },
  { label: "th p", selector: ".tiptap th p" },
  { label: "blockquote p", selector: ".tiptap blockquote p" },
  { label: "h1", selector: ".tiptap h1" },
  { label: "h2", selector: ".tiptap h2" },
  { label: "h3", selector: ".tiptap h3" },
  { label: "h4", selector: ".tiptap h4" },
  { label: "h5", selector: ".tiptap h5" },
  { label: "h6", selector: ".tiptap h6" },
  { label: "pre", selector: ".tiptap pre" },
  { label: "code in p", selector: ".tiptap p code" },
  { label: "code in heading", selector: ".tiptap h6 code" },
  { label: "ul", selector: ".tiptap > ul:not([data-type])" },
  { label: "ol", selector: ".tiptap > ol" },
  { label: "task list", selector: '.tiptap > ul[data-type="taskList"]' },
];

type Metrics = Record<string, Record<string, string>>;

async function collectMetrics(page: Page): Promise<Metrics> {
  return page.evaluate(
    ({ probes, textProperties }) => {
      const out: Record<string, Record<string, string>> = {};
      for (const probe of probes) {
        const element = document.querySelectorAll(probe.selector)[
          probe.index ?? 0
        ];
        if (!element) {
          out[probe.label] = { missing: probe.selector };
          continue;
        }
        const style = getComputedStyle(element);
        const values: Record<string, string> = {};
        for (const name of [...textProperties, ...(probe.extra ?? [])]) {
          values[name] = style.getPropertyValue(name);
        }
        values.height = String(element.getBoundingClientRect().height);
        out[probe.label] = values;
      }
      return out;
    },
    { probes: PROBES, textProperties: TEXT_PROPERTIES },
  );
}

/**
 * Computed CSS values do not depend on the OS, but heights do (system
 * monospace, font ascent, wrapping), so heights are checked only on the
 * platform the snapshot was taken on.
 */
type Snapshot = {
  platform: string;
  browser: string;
  viewports: Record<string, Metrics>;
};

function readSnapshot(): Snapshot {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Snapshot;
}

function withoutHeights(metrics: Metrics): Metrics {
  return Object.fromEntries(
    Object.entries(metrics).map(([label, { height: _height, ...rest }]) => [
      label,
      rest,
    ]),
  );
}

test.describe("classic page state keeps main's document metrics", () => {
  // One process writes the snapshot, so the viewports run in order.
  test.describe.configure({ mode: "serial" });
  const generated: Snapshot = {
    platform: process.platform,
    browser: "",
    viewports: {},
  };

  for (const viewport of VIEWPORTS) {
    test(viewport.name, async ({ browser, baseURL }) => {
      if (!baseURL) throw new Error("no baseURL");
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
        isMobile: viewport.mobile,
        hasTouch: viewport.mobile,
        colorScheme: "light",
        reducedMotion: "reduce",
        serviceWorkers: "block",
      });
      const page = await context.newPage();
      await preparePixelPage(page, baseURL, { theme: "light" });

      const pageStyle = await page.evaluate(
        () => document.documentElement.dataset.pageStyle ?? null,
      );
      const metrics = await collectMetrics(page);
      await context.close();

      if (GENERATE) {
        generated.browser = `${browser.browserType().name()} ${browser.version()}`;
        generated.viewports[viewport.name] = metrics;
        return;
      }
      // A returning browser (the fixture seeds a legacy key) is classic.
      expect(pageStyle).toBe("classic");
      const snapshot = readSnapshot();
      const expected = snapshot.viewports[viewport.name];
      if (snapshot.platform === process.platform) {
        expect(metrics).toEqual(expected);
        return;
      }
      test.info().annotations.push({
        type: "heights skipped",
        description: `the snapshot was taken on ${snapshot.platform}; regenerate it from main on ${process.platform} to check heights`,
      });
      expect(withoutHeights(metrics)).toEqual(withoutHeights(expected));
    });
  }

  test.afterAll(() => {
    if (!GENERATE || Object.keys(generated.viewports).length === 0) return;
    mkdirSync(path.dirname(SNAPSHOT_PATH), { recursive: true });
    writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(generated, null, 2)}\n`);
  });
});
