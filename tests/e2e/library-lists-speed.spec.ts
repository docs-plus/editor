/**
 * List speed targets (details spec §6.3): first paint ≤ 100 ms at 1,000
 * documents and ≤ 300 ms at 10,000, measured from the click that opens the
 * list to the frame after its rows paint (two animation frames). Also the
 * filter's keystroke time. The targets are asserted only on a production
 * harness build (`LIBRARY_HARNESS_PROD=1`); development React overstates
 * them, so CI's development harness only records the numbers:
 *   LIBRARY_HARNESS_PROD=1 bun tests/harness/library/serve.ts &
 *   bun playwright test --project=library library-lists-speed
 */
import { expect, type Page, test } from "@playwright/test";

const TARGETS: Record<number, number> = { 1000: 100, 10000: 300 };
const RUNS = 5;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Clicks the element `selector` finds (with the text `text`, if given),
 * then waits two frames; returns the elapsed ms.
 */
function timeClick(
  page: Page,
  selector: string,
  text?: string,
): Promise<number> {
  return page.evaluate(
    async ({ selector, text }) => {
      const element = [
        ...document.querySelectorAll<HTMLElement>(selector),
      ].find(
        (candidate) =>
          text === undefined || candidate.textContent?.trim() === text,
      );
      if (!element) throw new Error(`no ${selector}`);
      const start = performance.now();
      element.click();
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
      if (!document.querySelector('.lib-grid [role="row"][data-key]')) {
        throw new Error("no rows painted");
      }
      return performance.now() - start;
    },
    { selector, text },
  );
}

/** Types one character into the filter and waits for the rows to settle. */
function timeKeystroke(page: Page, text: string): Promise<number> {
  return page.evaluate(async (value) => {
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="Filter by title, tag or folder"]',
    );
    if (!input) throw new Error("no filter");
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    const start = performance.now();
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    // The deferred filter renders after the urgent one: three frames.
    for (let n = 0; n < 3; n++) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return performance.now() - start;
  }, text);
}

for (const size of [1000, 10000]) {
  test(`lists paint within target at ${size} documents`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto(`/?seed=${size}`);
    const prod = await page.evaluate(
      () => (window as unknown as { __harnessProd: boolean }).__harnessProd,
    );
    const folder: number[] = [];
    const recent: number[] = [];
    const filter: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      // Library root first (small), then the folder holding all of them,
      // opened from the list so the sidebar tree stays collapsed.
      await page.getByRole("button", { name: "Library", exact: true }).click();
      await expect(
        page.locator('.lib-grid [data-key="folder:f-big"]'),
      ).toBeVisible();
      folder.push(
        await timeClick(
          page,
          '.lib-grid [role="row"][data-key="folder:f-big"]',
        ),
      );
      await expect(page.getByRole("heading", { name: "Big" })).toBeVisible();
      filter.push(await timeKeystroke(page, "r"));
      // Recent: a third of them, grouped by date.
      recent.push(
        await timeClick(
          page,
          'nav[aria-label="Files"] button.lib-item',
          "Recent",
        ),
      );
      await expect(page.getByRole("heading", { name: "Recent" })).toBeVisible();
    }
    const result = {
      size,
      production: prod,
      folderMs: Math.round(median(folder)),
      recentMs: Math.round(median(recent)),
      filterKeystrokeMs: Math.round(median(filter)),
    };
    console.log(`library list speed: ${JSON.stringify(result)}`);
    test.info().annotations.push({
      type: "speed",
      description: JSON.stringify(result),
    });
    if (prod) {
      expect(result.folderMs).toBeLessThanOrEqual(TARGETS[size]);
      expect(result.recentMs).toBeLessThanOrEqual(TARGETS[size]);
    }
  });
}
