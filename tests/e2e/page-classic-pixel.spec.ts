import { writeFile } from "node:fs/promises";

import {
  type Browser,
  expect,
  type Page,
  type TestInfo,
  test,
} from "@playwright/test";

import {
  freezePage,
  type PixelTheme,
  preparePixelPage,
} from "./helpers/page-fixture";

/**
 * Classic page state (P2.9c-1): a returning browser must see the document
 * exactly as `main` draws it. Loads the same fixture on `main` (served at
 * CLASSIC_BASELINE_URL) and on the branch (the test's baseURL) and compares
 * screenshots byte for byte. Off unless CLASSIC_BASELINE_URL is set:
 *
 *   CI= E2E_BASE_URL=http://localhost:3192 \
 *     CLASSIC_BASELINE_URL=http://localhost:3190 \
 *     bun playwright test tests/e2e/page-classic-pixel.spec.ts --project=chromium
 *
 * On a mismatch both PNGs, a diff PNG and a summary land in the test's
 * output folder under test-results/.
 */

const BASELINE_URL = process.env.CLASSIC_BASELINE_URL;

const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900, mobile: false },
  { name: "phone", width: 375, height: 812, mobile: true },
] as const;

const THEMES: PixelTheme[] = ["light", "dark"];

type Shot = { name: string; main: Buffer; branch: Buffer };

type DiffSummary = {
  mainSize: string;
  branchSize: string;
  differingPixels: number;
  box: { x: number; y: number; width: number; height: number } | null;
  diffPng: string | null;
};

async function openSide(
  browser: Browser,
  baseURL: string,
  viewport: (typeof VIEWPORTS)[number],
  theme: PixelTheme,
): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    isMobile: viewport.mobile,
    hasTouch: viewport.mobile,
    colorScheme: theme,
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await preparePixelPage(page, baseURL, { theme });
  return page;
}

/**
 * Screenshots until two in a row match, so late settles (outline rebuild,
 * toolbar notify, tab title) finish before the frame that counts.
 */
async function stableShot(take: () => Promise<Buffer>): Promise<Buffer> {
  let previous = await take();
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    const next = await take();
    if (next.equals(previous)) return next;
    previous = next;
  }
  throw new Error("the page never settled: 20 screenshots in a row differ");
}

/**
 * The part of `.document-editor-content` the wrapper shows. An element
 * screenshot of the card would include everything the scroll container
 * clips, so the comparison clips to what a reader can see.
 */
async function visibleContentClip(page: Page) {
  return page.evaluate(() => {
    const content = document.querySelector(".document-editor-content");
    const wrapper = document.querySelector(".document-editor-wrapper");
    if (!content || !wrapper) throw new Error("no editor card on the page");
    const a = content.getBoundingClientRect();
    const b = wrapper.getBoundingClientRect();
    const left = Math.max(a.left, b.left, 0);
    const top = Math.max(a.top, b.top, 0);
    const right = Math.min(a.right, b.right, window.innerWidth);
    const bottom = Math.min(a.bottom, b.bottom, window.innerHeight);
    const x = Math.floor(left);
    const y = Math.floor(top);
    return {
      x,
      y,
      width: Math.ceil(right) - x,
      height: Math.ceil(bottom) - y,
    };
  });
}

async function captureState(page: Page, label: string) {
  const options = { animations: "disabled", caret: "hide" } as const;
  return {
    [`${label}-content`]: await stableShot(async () =>
      page.screenshot({ ...options, clip: await visibleContentClip(page) }),
    ),
    [`${label}-viewport`]: await stableShot(() => page.screenshot(options)),
  };
}

/**
 * Scrolls the wrapper to `top` (clamped by the browser) and returns where it
 * landed and how far it can go.
 */
async function scrollWrapperTo(page: Page, top: number) {
  const position = await page.evaluate((target) => {
    const wrapper = document.querySelector(".document-editor-wrapper");
    if (!wrapper) throw new Error("no .document-editor-wrapper");
    wrapper.scrollTop = target;
    return {
      top: wrapper.scrollTop,
      max: wrapper.scrollHeight - wrapper.clientHeight,
      step: wrapper.clientHeight,
    };
  }, top);
  await freezePage(page);
  return position;
}

/**
 * Captures the top, then one wrapper height at a time down to the bottom,
 * so every line of the fixture is compared at least once.
 */
async function captureAll(page: Page): Promise<Record<string, Buffer>> {
  const shots: Record<string, Buffer> = {};
  let position = await scrollWrapperTo(page, 0);
  Object.assign(shots, await captureState(page, "scroll-0"));
  while (position.top < position.max) {
    position = await scrollWrapperTo(page, position.top + position.step);
    const label =
      position.top >= position.max ? "bottom" : `scroll-${position.top}`;
    Object.assign(shots, await captureState(page, label));
  }
  return shots;
}

/** Decodes both PNGs in the browser (no image dependency) and diffs them. */
async function diffInBrowser(page: Page, shot: Shot): Promise<DiffSummary> {
  return page.evaluate(
    async ({ main, branch }) => {
      const decode = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(
          new Blob([bytes], { type: "image/png" }),
        );
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("no 2d context");
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const a = await decode(main);
      const b = await decode(branch);
      const width = Math.max(a.width, b.width);
      const height = Math.max(a.height, b.height);
      const out = new OffscreenCanvas(width, height);
      const context = out.getContext("2d");
      if (!context) throw new Error("no 2d context");
      const diff = context.createImageData(width, height);
      let differing = 0;
      let minX = width;
      let minY = height;
      let maxX = -1;
      let maxY = -1;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const inA = x < a.width && y < a.height;
          const inB = x < b.width && y < b.height;
          const ia = (y * a.width + x) * 4;
          const ib = (y * b.width + x) * 4;
          let same = inA && inB;
          for (let c = 0; same && c < 4; c++) {
            same = a.data[ia + c] === b.data[ib + c];
          }
          const o = (y * width + x) * 4;
          if (same) {
            const grey = inA ? a.data[ia] * 0.3 + 64 : 255;
            diff.data[o] = grey;
            diff.data[o + 1] = grey;
            diff.data[o + 2] = grey;
          } else {
            differing++;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            diff.data[o] = 255;
          }
          diff.data[o + 3] = 255;
        }
      }
      context.putImageData(diff, 0, 0);
      const blob = await out.convertToBlob({ type: "image/png" });
      const buffer = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (const byte of buffer) binary += String.fromCharCode(byte);
      return {
        mainSize: `${a.width}x${a.height}`,
        branchSize: `${b.width}x${b.height}`,
        differingPixels: differing,
        box:
          maxX < 0
            ? null
            : {
                x: minX,
                y: minY,
                width: maxX - minX + 1,
                height: maxY - minY + 1,
              },
        diffPng: differing > 0 ? btoa(binary) : null,
      };
    },
    {
      main: shot.main.toString("base64"),
      branch: shot.branch.toString("base64"),
    },
  );
}

async function reportMismatch(
  page: Page,
  testInfo: TestInfo,
  shot: Shot,
): Promise<string> {
  const summary = await diffInBrowser(page, shot);
  await writeFile(testInfo.outputPath(`${shot.name}-main.png`), shot.main);
  await writeFile(testInfo.outputPath(`${shot.name}-branch.png`), shot.branch);
  if (summary.diffPng) {
    await writeFile(
      testInfo.outputPath(`${shot.name}-diff.png`),
      Buffer.from(summary.diffPng, "base64"),
    );
  }
  const { diffPng: _png, ...rest } = summary;
  const line = `${shot.name}: ${JSON.stringify(rest)}`;
  await writeFile(testInfo.outputPath(`${shot.name}-summary.json`), line);
  return line;
}

test.describe("classic page state is pixel-identical to main", () => {
  test.skip(!BASELINE_URL, "set CLASSIC_BASELINE_URL to main's server");
  test.describe.configure({ mode: "parallel" });

  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      test(`${theme} ${viewport.name}`, async ({
        browser,
        baseURL,
      }, testInfo) => {
        test.setTimeout(120_000);
        if (!BASELINE_URL || !baseURL) throw new Error("missing URLs");

        const mainPage = await openSide(browser, BASELINE_URL, viewport, theme);
        const branchPage = await openSide(browser, baseURL, viewport, theme);
        const main = await captureAll(mainPage);
        const branch = await captureAll(branchPage);

        expect(Object.keys(main)).toContain("bottom-content");
        const mismatches: string[] = [];
        for (const name of new Set([
          ...Object.keys(main),
          ...Object.keys(branch),
        ])) {
          const shot = { name, main: main[name], branch: branch[name] };
          if (!shot.main || !shot.branch) {
            mismatches.push(
              `${name}: only ${shot.main ? "main" : "the branch"} scrolls there (the document heights differ)`,
            );
          } else if (!shot.main.equals(shot.branch)) {
            mismatches.push(await reportMismatch(mainPage, testInfo, shot));
          }
        }
        expect(mismatches, "screenshots that differ from main").toEqual([]);

        await mainPage.context().close();
        await branchPage.context().close();
      });
    }
  }
});
