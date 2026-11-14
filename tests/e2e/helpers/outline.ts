import { expect, type Page } from "@playwright/test";

/**
 * The docked outline's active row: its text, and whether all of it shows
 * inside the outline's scroll box and below the sticky toolbar (1px of
 * rounding). Null when no row is active.
 */
export function activeOutlineRow(
  page: Page,
): Promise<{ text: string; inView: boolean } | null> {
  return page.evaluate(() => {
    const row = document.querySelector<HTMLElement>(
      ".toc-sidebar-item--active",
    );
    const list = row?.closest<HTMLElement>(".toc-sidebar");
    if (!row || !list) return null;
    const toolbar = document.querySelector(
      '[role="toolbar"][data-variant="fixed"]',
    );
    const top = Math.max(
      list.getBoundingClientRect().top,
      toolbar?.getBoundingClientRect().bottom ?? 0,
    );
    const box = row.getBoundingClientRect();
    const bottom = list.getBoundingClientRect().bottom;
    return {
      text: row.textContent?.trim() ?? "",
      inView: box.top >= top - 1 && box.bottom <= bottom + 1,
    };
  });
}

/**
 * Waits until the editor stops scrolling (the same offset for 10 frames,
 * e.g. after a smooth jump and its settle pass) and returns that offset.
 */
export async function settledEditorScrollTop(page: Page): Promise<number> {
  await expect
    .poll(async () => new Set(await editorScrollTops(page)).size, {
      timeout: 6_000,
    })
    .toBe(1);
  const [top] = await editorScrollTops(page, 1);
  return top;
}

/** The editor's scroll offset, sampled across `frames` animation frames. */
export function editorScrollTops(page: Page, frames = 10): Promise<number[]> {
  return page.evaluate(
    (count) =>
      new Promise<number[]>((resolve) => {
        const scroller = document.querySelector(".document-editor-wrapper");
        const tops: number[] = [];
        const sample = () => {
          tops.push(scroller?.scrollTop ?? -1);
          if (tops.length >= count) resolve(tops);
          else requestAnimationFrame(sample);
        };
        sample();
      }),
    frames,
  );
}
