/**
 * The phone bar never paints unstyled while another lazy stylesheet is
 * still loading. Safari (WebKit) keeps a loaded stylesheet inactive until
 * every other one has loaded or failed, so the bar's chunk could render
 * before its own CSS applied; it now waits for it (`stylesApplied`), and
 * never longer than its timeout. Run on `--project=webkit` too: Chromium
 * applies each stylesheet as it loads, so it passes there either way.
 */
import { expect, type Page, type Route, test } from "@playwright/test";

import { openToolbarTestDoc } from "./helpers/a11y";
import { CSS_CHUNK_URLS } from "./helpers/lazy-chunk";

const bar = (page: Page) => page.getByRole("toolbar", { name: "Formatting" });

/**
 * Holds the colour popover's CSS chunk, which the idle preload fetches on
 * desktop, until `finish` serves it or fails it.
 */
async function holdColourCss(page: Page) {
  let finish: (outcome: "load" | "fail") => void = () => {};
  const done = new Promise<"load" | "fail">((resolve) => {
    finish = resolve;
  });
  let requested = false;
  await page.route("**/_next/static/chunks/**", async (route: Route) => {
    if (!route.request().url().includes(CSS_CHUNK_URLS.colorPanel)) {
      await route.continue();
      return;
    }
    requested = true;
    const response = await route.fetch();
    if ((await done) === "fail") await route.abort();
    else await route.fulfill({ response });
  });
  return { finish, requested: () => requested };
}

/**
 * Opens a document on desktop, so the idle preload starts fetching the
 * held stylesheet, then records the bar's first-cell `min-width` (44px
 * from the bar's lazy CSS, `auto` without it) in every frame it exists.
 */
async function openWithColourCssHeld(page: Page) {
  const hold = await holdColourCss(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await openToolbarTestDoc(page);
  await expect.poll(hold.requested, { timeout: 15_000 }).toBe(true);
  await page.evaluate(() => {
    const frames: string[] = [];
    (window as { __barFrames?: string[] }).__barFrames = frames;
    const sample = () => {
      const cell = document.querySelector(
        '[data-variant="docked"] [data-toolbar-item]',
      );
      if (cell) frames.push(getComputedStyle(cell).minWidth);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  return hold;
}

const barFrames = (page: Page) =>
  page.evaluate(() => (window as { __barFrames?: string[] }).__barFrames);

/** The bar's own CSS has loaded (in WebKit it may not apply yet). */
const barCssLoaded = (page: Page) =>
  page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
    ).some(({ sheet }) =>
      Array.from(sheet?.cssRules ?? []).some((rule) =>
        rule.cssText.includes("data-phone-slot"),
      ),
    ),
  );

/**
 * Resolves once the bar is on screen, or after 1s (under the 1.5s that
 * `stylesApplied` waits at most): long enough for a bar that did not wait
 * for its CSS to render unstyled.
 */
const barOrOneSecond = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const start = performance.now();
        const tick = () =>
          document.querySelector('[data-variant="docked"]') ||
          performance.now() - start > 1000
            ? resolve()
            : requestAnimationFrame(tick);
        tick();
      }),
  );

test.describe("phone bar while another lazy stylesheet loads", () => {
  for (const outcome of ["load", "fail"] as const) {
    test(`is never painted unstyled; the other sheet then ${outcome}s`, async ({
      page,
    }) => {
      const hold = await openWithColourCssHeld(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await expect
        .poll(() => barCssLoaded(page), { timeout: 15_000 })
        .toBe(true);
      await barOrOneSecond(page);
      hold.finish(outcome);
      await expect(bar(page)).toBeVisible();
      await expect
        .poll(async () => (await barFrames(page))?.length)
        .toBeGreaterThan(2);
      expect(new Set(await barFrames(page))).toEqual(new Set(["44px"]));
    });
  }

  test("shows up even while the other sheet never finishes", async ({
    page,
  }) => {
    const hold = await openWithColourCssHeld(page);
    await page.setViewportSize({ width: 390, height: 844 });
    // `stylesApplied` gives up after 1.5s: the bar never waits for good.
    await expect(bar(page)).toBeVisible({ timeout: 15_000 });
    await expect(bar(page).getByRole("button", { name: "Bold" })).toBeVisible();
    hold.finish("load");
  });
});
