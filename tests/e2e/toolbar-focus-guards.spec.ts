/**
 * Base UI renders `tabindex="0"` focus guards around an open popup's
 * trigger (and its portal) inside the toolbar, and routes Tab out of the
 * popup through them. The toolbar's roving tabindex must leave them alone:
 * never stamped `data-toolbar-item` or `tabindex="-1"`, never an arrow
 * target, and Tab / Shift+Tab out of an open menu unchanged.
 */
import { expect, type Page, test } from "@playwright/test";

import { openToolbarTestDoc } from "./helpers/a11y";

const row = (page: Page) =>
  page.locator('[role="toolbar"][data-variant="fixed"]');
const styleTrigger = (page: Page) =>
  row(page).locator('[data-toolbar-group="style"] button');
const rowGuards = (page: Page) =>
  row(page).locator("[data-base-ui-focus-guard]");

/** Every guard in a toolbar, as the roving code left it. */
const guardStates = (page: Page) =>
  page.evaluate(() =>
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '[role="toolbar"] [data-base-ui-focus-guard]',
      ),
    ).map((guard) => ({
      tabindex: guard.getAttribute("tabindex"),
      item: guard.hasAttribute("data-toolbar-item"),
    })),
  );

const focusInMenu = (page: Page) =>
  page.evaluate(() =>
    Boolean(document.activeElement?.closest('[role="menu"]')),
  );
const focusedLabel = (page: Page) =>
  page.evaluate(() => {
    const active = document.activeElement;
    if (!active?.closest('[role="toolbar"]')) return null;
    return active.getAttribute("aria-label");
  });

/** Opens Text style ▾ from the keyboard, focus in the menu. */
async function openStyleMenuByKeyboard(page: Page, key: "Enter" | "ArrowDown") {
  await page.keyboard.press("Shift");
  await styleTrigger(page).focus();
  await expect(styleTrigger(page)).toBeFocused();
  await page.keyboard.press(key);
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(styleTrigger(page)).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => focusInMenu(page)).toBe(true);
}

/**
 * Opens Text style ▾ by mouse, then puts focus back on its trigger while
 * the menu stays open (a screen reader's cursor can do this): its guards
 * sit either side of it.
 */
async function focusTriggerOfOpenMenu(page: Page) {
  await page.keyboard.press("Shift");
  await styleTrigger(page).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(styleTrigger(page)).toHaveAttribute("aria-expanded", "true");
  await styleTrigger(page).evaluate((el) => (el as HTMLElement).focus());
  await expect(styleTrigger(page)).toBeFocused();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect.poll(() => rowGuards(page).count()).toBeGreaterThan(0);
}

for (const [popup, nth] of [
  ["text style menu", 0],
  ["list menu", 1],
] as const) {
  test(`guards around the open ${popup} never become toolbar items`, async ({
    page,
  }) => {
    await openToolbarTestDoc(page);
    await row(page)
      .locator('button[aria-haspopup="menu"]:visible')
      .nth(nth)
      .click();
    await expect(page.getByRole("menu")).toBeVisible();
    await expect.poll(() => rowGuards(page).count()).toBeGreaterThan(0);
    // Moving inside the menu re-renders the toolbar's popup subtree.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    const states = await guardStates(page);
    expect(states.length).toBeGreaterThan(0);
    for (const state of states) {
      expect(state).toEqual({ tabindex: "0", item: false });
    }
  });
}

test("Tab out of an open menu closes it and moves on past the toolbar", async ({
  page,
}) => {
  await openToolbarTestDoc(page);
  await openStyleMenuByKeyboard(page, "Enter");
  // The menu may hold a tabbable control of its own: Tab past it.
  for (let i = 0; i < 4 && (await focusInMenu(page)); i++) {
    await page.keyboard.press("Tab");
    await expect
      .poll(async () =>
        (await focusInMenu(page))
          ? "menu"
          : await page.evaluate(() => document.activeElement?.tagName),
      )
      .not.toBe("BODY");
  }
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(styleTrigger(page)).toHaveAttribute("aria-expanded", "false");
  // The next tab stop after the row is the document.
  await expect(page.locator(".tiptap")).toBeFocused();
  await expect(rowGuards(page)).toHaveCount(0);
});

test("Shift+Tab out of an open menu closes it with focus on its trigger", async ({
  page,
}) => {
  await openToolbarTestDoc(page);
  await openStyleMenuByKeyboard(page, "ArrowDown");
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(styleTrigger(page)).toBeFocused();
  await expect(styleTrigger(page)).toHaveAttribute("aria-expanded", "false");
  // One more leaves the toolbar backwards: it is still a single Tab stop.
  await page.keyboard.press("Shift+Tab");
  await expect.poll(() => focusedLabel(page)).toBeNull();
  await expect(styleTrigger(page)).not.toBeFocused();
});

test("an arrow from the trigger of an open menu roves past its guards", async ({
  page,
}) => {
  await openToolbarTestDoc(page);
  // Where ArrowRight goes from Text style ▾ with nothing open.
  await page.keyboard.press("Shift");
  await styleTrigger(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => focusedLabel(page)).not.toBeNull();
  const next = await focusedLabel(page);
  expect(next).not.toBe(await styleTrigger(page).getAttribute("aria-label"));
  await page.keyboard.press("ArrowLeft");
  await expect(styleTrigger(page)).toBeFocused();

  await focusTriggerOfOpenMenu(page);
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => focusedLabel(page)).toBe(next);
  await page.keyboard.press("ArrowLeft");
  await expect(styleTrigger(page)).toBeFocused();
});

test("Tab from the trigger of an open menu closes it and moves to the document", async ({
  page,
}) => {
  await openToolbarTestDoc(page);
  await focusTriggerOfOpenMenu(page);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(page.locator(".tiptap")).toBeFocused();
});

test("Shift+Tab from the trigger of an open menu closes it and leaves the toolbar", async ({
  page,
}) => {
  await openToolbarTestDoc(page);
  await focusTriggerOfOpenMenu(page);
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const active = document.activeElement;
        if (!active || active === document.body) return "body";
        return active.closest('[role="toolbar"]') ? "toolbar" : "before";
      }),
    )
    .toBe("before");
});
