/**
 * The document-link visual matrix (linking review §2 "Tests and visuals"):
 * every link state in a paragraph, a heading, a list, a table and styled
 * text (bold, coloured and resized, highlighted), in light and dark, plus
 * a Persian title in a left-to-right line and an English document in a
 * right-to-left one. On the library harness (`?view=links&matrix=1`).
 *
 * Asserts, for every document link:
 * - the icon is the link's own colour (`currentColor`);
 * - the link's text, and each styled run inside it, reaches 4.5:1 on what
 *   it sits on (the page, or a highlight);
 * - links that don't open are dashed, inner runs included.
 * With `LINKS_MATRIX_SHOTS=<dir>`, it also saves the design-review
 * screenshots there.
 */
import { expect, type Page, test } from "@playwright/test";

import { contrastRatio, resolveRgb } from "./helpers/a11y";

const DASHED = new Set(["not_available", "invalid", "unknown_form"]);
const SHOTS = process.env.LINKS_MATRIX_SHOTS;

type Run = { text: string; color: string; background: string };
type LinkFacts = {
  state: string | null;
  linkColor: string;
  iconColor: string | null;
  decoration: string[];
  runs: Run[];
};

/** Every link with its icon, styles and the background under each run. */
function linkFacts(page: Page): Promise<LinkFacts[]> {
  return page.evaluate(() => {
    const backgroundOf = (element: Element): string => {
      for (let at: Element | null = element; at; at = at.parentElement) {
        const color = getComputedStyle(at).backgroundColor;
        if (color && color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
          return color;
        }
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    return [...document.querySelectorAll(".h-editor .ProseMirror a")].map(
      (anchor) => {
        const icon = anchor.querySelector<HTMLElement>(".doc-link-icon");
        const runs: Run[] = [];
        const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const parent = node.parentElement;
          if (!parent || !node.textContent?.trim()) continue;
          runs.push({
            text: node.textContent,
            color: getComputedStyle(parent).color,
            background: backgroundOf(parent),
          });
        }
        const decorated = [
          anchor,
          ...anchor.querySelectorAll("span:not(.doc-link-icon)"),
        ];
        return {
          state: icon?.dataset.linkState ?? null,
          linkColor: getComputedStyle(anchor).color,
          iconColor: icon ? getComputedStyle(icon).color : null,
          decoration: decorated.map(
            (element) => getComputedStyle(element).textDecorationStyle,
          ),
          runs,
        };
      },
    );
  });
}

for (const theme of ["light", "dark"] as const) {
  test(`document links read in every context (${theme})`, async ({ page }) => {
    await page.setViewportSize({ width: 1100, height: 1400 });
    await page.goto(`/?view=links&matrix=1&theme=${theme}`);
    await expect(page.locator(".h-editor .ProseMirror")).toBeVisible();
    const facts = await linkFacts(page);
    const states = new Set(facts.map((link) => link.state));
    for (const state of [
      "resolves",
      "in_trash",
      "not_available",
      "invalid",
      "unknown_form",
      "here",
    ]) {
      expect(states.has(state)).toBe(true);
    }
    const failures: string[] = [];
    for (const link of facts) {
      if (link.state === null) continue;
      if (link.iconColor !== link.linkColor) {
        failures.push(
          `${link.state}: icon ${link.iconColor} vs link ${link.linkColor}`,
        );
      }
      if (
        DASHED.has(link.state) &&
        link.decoration.some((s) => s !== "dashed")
      ) {
        failures.push(
          `${link.state}: not dashed throughout (${link.decoration})`,
        );
      }
      for (const run of link.runs) {
        const ratio = contrastRatio(
          await resolveRgb(page, run.color),
          await resolveRgb(page, run.background),
        );
        if (ratio < 4.5) {
          failures.push(
            `${link.state} "${run.text}": ${ratio.toFixed(2)}:1 (${run.color} on ${run.background})`,
          );
        }
      }
    }
    expect(failures).toEqual([]);
    if (SHOTS) {
      await page.screenshot({
        path: `${SHOTS}/links-matrix-${theme}.png`,
        fullPage: true,
      });
    }
  });
}

test("a right-to-left page keeps each icon beside its link", async ({
  page,
}) => {
  await page.goto("/?view=links&matrix=1&dir=rtl");
  await expect(page.locator(".h-editor .ProseMirror")).toBeVisible();
  const gaps = await page.evaluate(() =>
    [...document.querySelectorAll(".h-editor .ProseMirror a")]
      .map((anchor) => {
        const icon = anchor.querySelector(".doc-link-icon");
        if (!icon) return null;
        const a = anchor.getBoundingClientRect();
        const i = icon.getBoundingClientRect();
        // The icon sits inside its link's box, on its line.
        return (
          i.left >= a.left - 1 && i.right <= a.right + 1 && i.top >= a.top - 4
        );
      })
      .filter((ok) => ok !== null),
  );
  expect(gaps.length).toBeGreaterThan(0);
  expect(gaps.every(Boolean)).toBe(true);
  if (SHOTS) {
    await page.screenshot({
      path: `${SHOTS}/links-matrix-rtl.png`,
      fullPage: true,
    });
  }
});
