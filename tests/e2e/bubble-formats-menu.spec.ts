import { expect, type Page, test } from "@playwright/test";

import { EditorPage, typeInNewParagraphAtEnd } from "./helpers/editor-page";

/**
 * The bubble's Formats menu (the Repeat split's chevron) and the palette
 * it opens: focus never drops to `body` (a11y review of PR E, C1).
 *
 * Where focus goes when a palette closes: `CommandPalette.close()` always
 * focuses the editor, never the control that opened it (the Formats
 * chevron, or "All actions…" in the row's menu). That is by design: the
 * editor keeps its selection, so the bubble comes back over it, and these
 * tests check the selection is the one the user had.
 */

const PALETTE = "[data-command-palette]";

const bubble = (page: Page) => page.locator("[data-smart-bubble]");
const bubbleToolbar = (page: Page) =>
  page.getByRole("toolbar", { name: "Selection formatting" });
const formatsButton = (page: Page) =>
  bubbleToolbar(page).getByRole("button", { name: "Formats" });
const menu = (page: Page) => page.getByRole("menu");

/** "alpha beta gamma delta" with "beta" bold, so Repeat has a bundle. */
async function openDoc(page: Page): Promise<void> {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForSync();
  await typeInNewParagraphAtEnd(page, "alpha beta gamma delta");
  await select(page, "beta");
  await page.keyboard.press("ControlOrMeta+b");
}

/** Selects the first `needle` with a focused editor, like a drag. */
async function select(page: Page, needle: string): Promise<void> {
  await page.evaluate((target) => {
    const editor = window.__tiptap_editor;
    if (!editor) throw new Error("editor missing");
    let from = -1;
    editor.state.doc.descendants((node, pos) => {
      if (from >= 0 || !node.isText) return from < 0;
      const at = node.text?.indexOf(target) ?? -1;
      if (at >= 0) from = pos + at;
      return from < 0;
    });
    if (from < 0) throw new Error(`"${target}" not found`);
    editor
      .chain()
      .focus()
      .setTextSelection({ from, to: from + target.length })
      .run();
  }, needle);
}

const selectionRange = (page: Page) =>
  page.evaluate(() => {
    const selection = window.__tiptap_editor?.state.selection;
    return { from: selection?.from, to: selection?.to };
  });

const focusInMenu = (page: Page) =>
  page.evaluate(
    () => document.activeElement?.closest('[role="menu"]') !== null,
  );

/** Selects `word` and waits for the bubble with its Repeat split. */
async function selectInBubble(page: Page, word: string) {
  await select(page, word);
  await expect(bubble(page)).toHaveAttribute("data-state", "open");
  await expect(formatsButton(page)).toBeVisible();
}

/** Alt+F10, then ArrowRight until the Formats chevron has focus. */
async function focusFormats(page: Page) {
  await page.keyboard.press("Alt+F10");
  await expect(
    bubbleToolbar(page).getByRole("button", { name: "Bold", exact: true }),
  ).toBeFocused();
  for (let step = 0; step < 12; step += 1) {
    const done = await formatsButton(page).evaluate(
      (el) => el === document.activeElement,
    );
    if (done) return;
    await page.keyboard.press("ArrowRight");
  }
  await expect(formatsButton(page)).toBeFocused();
}

/**
 * Records, frame by frame, whether focus ever sits on `body` until
 * `stopSelector` has it. Read with `bodyFocusSeen`.
 */
async function watchBodyFocus(page: Page, stopSelector: string) {
  await page.evaluate((stop) => {
    const w = window as Window & { __bodyFocus?: boolean };
    w.__bodyFocus = false;
    const tick = () => {
      if (document.activeElement === document.body) w.__bodyFocus = true;
      if (!document.activeElement?.matches(stop)) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, stopSelector);
}

const bodyFocusSeen = (page: Page) =>
  page.evaluate(
    () => (window as Window & { __bodyFocus?: boolean }).__bodyFocus,
  );

async function expectMenuContents(page: Page) {
  await expect(menu(page)).toBeVisible();
  await expect(bubble(page)).toHaveAttribute("data-state", "open");
  expect(await focusInMenu(page)).toBe(true);
  const items = menu(page).getByRole("menuitem");
  // Names, not text: the long forms are hidden descriptions.
  await expect(items.nth(0)).toHaveAccessibleName("Repeat B");
  await expect(items.nth(1)).toHaveAccessibleName("Copy formatting");
  await expect(items.nth(2)).toHaveAccessibleName("Save as format…");
}

test.describe("bubble Formats menu", () => {
  test("opens from the keyboard and Esc returns focus to the chevron", async ({
    page,
  }) => {
    await openDoc(page);
    await selectInBubble(page, "delta");
    await focusFormats(page);
    await page.keyboard.press("Enter");
    await expectMenuContents(page);
    // Past the plugin's 250 ms update debounce: the bubble stays.
    await page.waitForTimeout(400);
    await expect(menu(page)).toBeVisible();
    expect(await focusInMenu(page)).toBe(true);

    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await expect(formatsButton(page)).toBeFocused();
    await expect(bubble(page)).toHaveAttribute("data-state", "open");
  });

  test("opens on a click and stays open", async ({ page }) => {
    await openDoc(page);
    await selectInBubble(page, "delta");
    const before = await selectionRange(page);
    await formatsButton(page).click();
    await expectMenuContents(page);
    await page.waitForTimeout(400);
    await expect(menu(page)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(menu(page)).toHaveCount(0);
    await expect(formatsButton(page)).toBeFocused();
    expect(await selectionRange(page)).toEqual(before);
  });

  test("Save as format… hands focus to the name field, then back to the editor", async ({
    page,
  }) => {
    await openDoc(page);
    // Save needs set formatting: the bold word.
    await selectInBubble(page, "beta");
    const before = await selectionRange(page);
    await focusFormats(page);
    await page.keyboard.press("Enter");
    await expect(menu(page)).toBeVisible();
    const save = menu(page).getByRole("menuitem", { name: "Save as format…" });
    for (let step = 0; step < 6; step += 1) {
      if (await save.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("ArrowDown");
    }
    await expect(save).toBeFocused();

    await watchBodyFocus(page, `${PALETTE} input`);
    await page.keyboard.press("Enter");
    const name = page.getByLabel("Name");
    await expect(name).toBeFocused();
    expect(await bodyFocusSeen(page)).toBe(false);
    await expect(name).toHaveAttribute("maxlength", "40");
    await expect(name).toHaveAccessibleDescription(/Up to 40 characters/);

    await page.keyboard.type("Callout");
    await page.keyboard.press("Enter");
    await expect(page.locator(PALETTE)).toHaveCount(0);
    await expect(page.locator(".tiptap")).toBeFocused();
    expect(await selectionRange(page)).toEqual(before);
    await expect(
      page.getByRole("status").filter({ hasText: "Saved format ‘Callout’" }),
    ).toHaveCount(1);

    // The new format is listed under its group label.
    await expect(formatsButton(page)).toBeVisible();
    await formatsButton(page).click();
    await expect(
      menu(page)
        .getByRole("group", { name: "Your formats" })
        .getByRole("menuitem", { name: "Callout", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("Esc in the save dialog goes back to the list, then to the editor", async ({
    page,
  }) => {
    await openDoc(page);
    await selectInBubble(page, "beta");
    const before = await selectionRange(page);
    await formatsButton(page).click();
    await watchBodyFocus(page, `${PALETTE} input`);
    await menu(page).getByRole("menuitem", { name: "Save as format…" }).click();
    await expect(page.getByLabel("Name")).toBeFocused();
    expect(await bodyFocusSeen(page)).toBe(false);

    await page.keyboard.press("Escape");
    await expect(page.locator(PALETTE)).toBeVisible();
    await expect(page.getByPlaceholder("Search actions…")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(PALETTE)).toHaveCount(0);
    await expect(page.locator(".tiptap")).toBeFocused();
    expect(await selectionRange(page)).toEqual(before);
  });

  test("All actions… returns to the editor with the selection", async ({
    page,
  }) => {
    await openDoc(page);
    await select(page, "gamma");
    const before = await selectionRange(page);
    await page
      .getByRole("toolbar", { name: "Formatting", exact: true })
      .getByRole("button", { name: "More formatting" })
      .click();
    await page.getByRole("menuitem", { name: "All actions…" }).click();
    await expect(page.getByPlaceholder("Search actions…")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator(PALETTE)).toHaveCount(0);
    await expect(page.locator(".tiptap")).toBeFocused();
    expect(await selectionRange(page)).toEqual(before);
  });
});
