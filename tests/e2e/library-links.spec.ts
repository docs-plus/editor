/**
 * Document links (LK1) on the library harness's links view
 * (`tests/harness/library/links-view.tsx`): each search-linking §4.6 state
 * draws, links follow (Mod opens here, Mod+Shift or middle-click a new
 * tab), `here#` jumps in place, a missing heading says so, and no
 * `tinydocy:` href ever reaches the external opener. Runs in the `library`
 * project with the harness started.
 */
import { expect, type Page, test } from "@playwright/test";

const editor = (page: Page) => page.locator(".h-editor .ProseMirror");
const linkTo = (page: Page, text: string) =>
  editor(page).locator("a", { hasText: text });
const lastOpen = (page: Page) => page.getByTestId("last-open");
const external = (page: Page) => page.getByTestId("external");
const follows = (page: Page) => page.getByTestId("follows");
/** `announce()`'s live region (dnd-kit keeps one of its own). */
const said = (page: Page) =>
  page.locator('body > div[role="status"]:not([id^="DndLiveRegion"])');

/** The heading the caret sits in, if any. */
const caretHeading = (page: Page) =>
  page.evaluate(() => {
    const node = window.getSelection()?.anchorNode ?? null;
    const element = node instanceof Element ? node : node?.parentElement;
    return element?.closest("h1")?.textContent ?? null;
  });

test.beforeEach(async ({ page }) => {
  await page.goto("/?view=links");
  await expect(editor(page)).toBeVisible();
});

test("every link state draws its icon, broken ones with a dashed underline", async ({
  page,
}) => {
  const states = await editor(page)
    .locator(".doc-link-icon")
    .evaluateAll((icons) =>
      icons.map((icon) => (icon as HTMLElement).dataset.linkState),
    );
  expect(states).toEqual([
    "resolves",
    "resolves",
    "resolves",
    "in_trash",
    "deleted",
    "not_in_library",
    "unknown_form",
    "here",
  ]);
  // External links get no icon (no favicon request either).
  await expect(
    linkTo(page, "example.com").locator(".doc-link-icon"),
  ).toHaveCount(0);
  for (const text of ["A deleted note", "Someone else's", "From the future"]) {
    await expect(linkTo(page, text)).toHaveCSS(
      "text-decoration-style",
      "dashed",
    );
  }
  await expect(linkTo(page, "Q4 budget").first()).not.toHaveCSS(
    "text-decoration-style",
    "dashed",
  );
});

test("Mod-click follows in this tab, then to the heading", async ({ page }) => {
  await linkTo(page, "Q4 budget › Travel").click({
    modifiers: ["ControlOrMeta"],
  });
  await expect(lastOpen(page)).toHaveText("d-budget current");
  await expect(page.locator('[data-doc="d-budget"]')).toBeVisible();
  await expect.poll(() => caretHeading(page)).toBe("Travel");
  await expect(follows(page)).toHaveText("1");
  await expect(external(page)).toHaveText("");
});

test("Mod+Shift-click and middle-click open a new tab", async ({ page }) => {
  await linkTo(page, "Q4 budget")
    .first()
    .click({ modifiers: ["ControlOrMeta", "Shift"] });
  await expect(lastOpen(page)).toHaveText("d-budget tab");
  await expect(page.locator('[data-doc="d-demo"]')).toBeVisible();

  await page.getByTestId("last-open").evaluate((node) => {
    node.textContent = "";
  });
  await linkTo(page, "Old plan").click({ button: "middle" });
  await expect(lastOpen(page)).toHaveText("d-old tab");
  await expect(external(page)).toHaveText("");
});

test("a here# link jumps in place; a missing heading says so", async ({
  page,
}) => {
  await linkTo(page, "Second section").click({ modifiers: ["ControlOrMeta"] });
  await expect.poll(() => caretHeading(page)).toBe("Second section");
  await expect(follows(page)).toHaveText("1");

  await linkTo(page, "Q4 budget › Gone").click({
    modifiers: ["ControlOrMeta"],
  });
  await expect(page.locator('[data-doc="d-budget"]')).toBeVisible();
  await expect(said(page)).toHaveText(
    "The section this link pointed to was removed.",
  );
});

test("a link to a trashed document opens it; deleted and foreign ones only explain", async ({
  page,
}) => {
  await linkTo(page, "A deleted note").click({ modifiers: ["ControlOrMeta"] });
  await expect(said(page)).toHaveText("This document was deleted.");
  await linkTo(page, "Someone else's").click({ modifiers: ["ControlOrMeta"] });
  await expect(said(page)).toHaveText(
    "This links to a document that isn't in your library.",
  );
  // A newer form never opens anything.
  await linkTo(page, "From the future").click({ modifiers: ["ControlOrMeta"] });
  await expect(follows(page)).toHaveText("0");
  await expect(lastOpen(page)).toHaveText("");

  await linkTo(page, "Old plan").click({ modifiers: ["ControlOrMeta"] });
  await expect(lastOpen(page)).toHaveText("d-old current");
  await expect(external(page)).toHaveText("");
});

test("only web links reach the external opener", async ({ page }) => {
  await linkTo(page, "example.com").click({ modifiers: ["ControlOrMeta"] });
  await expect(external(page)).toHaveText("https://example.com/");
});

test("icons follow the library: trashing the target redraws its links", async ({
  page,
}) => {
  await page.evaluate(() =>
    (
      window as unknown as {
        __library: { trash(ids: string[]): Promise<unknown> };
      }
    ).__library.trash(["d-budget"]),
  );
  await expect(
    linkTo(page, "Q4 budget").first().locator(".doc-link-icon"),
  ).toHaveAttribute("data-link-state", "in_trash");
});
