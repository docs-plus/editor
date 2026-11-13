/**
 * Lazy surface chunks that fail to load (offline, or a deploy replaced
 * them) leave the editor and the tab strip mounted and typing working; a
 * popup says so in place of its body, and the next open fetches the chunk
 * again.
 */
import { expect, type Page, test } from "@playwright/test";

import { openToolbarTestDoc } from "./helpers/a11y";
import { typeInNewParagraphAtEnd } from "./helpers/editor-page";
import { CHUNK_MARKERS, interceptChunk } from "./helpers/lazy-chunk";

const row = (page: Page) =>
  page.locator('[role="toolbar"][data-variant="fixed"]');

/** Fails the chunk that defines `marker` with a 404 until the returned call. */
const failChunk = (page: Page, marker: string) =>
  interceptChunk(page, marker, (route) => route.fulfill({ status: 404 }));

const HINT = "Couldn’t load. Close and try again.";

/** No failure hint on screen: the bubble and the palette just stay away. */
const expectNoVisibleHint = (page: Page) =>
  expect(page.getByText(HINT).filter({ visible: true })).toHaveCount(0);

/** The page survived: editor and tabs mounted, and typing reaches the doc. */
async function expectEditorAlive(page: Page, word: string) {
  await expect(page.locator(".tiptap")).toBeVisible();
  await expect(page.locator("[data-tab-id]").first()).toBeVisible();
  await typeInNewParagraphAtEnd(page, word);
  await expect(page.locator(".tiptap")).toContainText(word);
}

test.describe("lazy surface chunks", () => {
  let pageErrors: Error[];

  test.beforeEach(({ page }) => {
    pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error));
  });

  test.afterEach(() => {
    expect(pageErrors.map((error) => error.message)).toEqual([]);
  });

  test("a colour popover chunk that 404s leaves the editor working", async ({
    page,
  }) => {
    // Before load, so the idle preload fails too (quietly).
    const restore = await failChunk(page, CHUNK_MARKERS.colorPanel);
    await openToolbarTestDoc(page);
    const chevron = row(page)
      .getByRole("button", { name: "More text colours" })
      .first();
    const dialog = page.getByRole("dialog", { name: "Text colours" });

    await chevron.click();
    await expect(dialog).toBeVisible();
    // The loading placeholder goes for a short hint; no swatch arrives.
    await expect(dialog.locator(".st-color-panel-fallback")).toHaveCount(0, {
      timeout: 10_000,
    });
    await expect(dialog.getByRole("status")).toHaveText(HINT);
    await expect(dialog.getByRole("button")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expectEditorAlive(page, "afterColour");

    // Back online: the next open fetches the chunk again.
    await restore();
    await chevron.click();
    await expect(dialog.getByRole("button").first()).toBeVisible();
    await expect(dialog.getByText(HINT)).toHaveCount(0);
  });

  test("an Insert step chunk that 404s leaves the editor working", async ({
    page,
  }) => {
    const restore = await failChunk(page, CHUNK_MARKERS.insertStep);
    await openToolbarTestDoc(page);
    const trigger = row(page)
      .locator('[data-toolbar-group="insert"]')
      .getByRole("button", { name: "Insert", exact: true });
    const dialog = page.getByRole("dialog", { name: "Insert table" });
    const openGrid = async () => {
      // Inserts are refused in the title: caret at the end of the body.
      await page.evaluate(() => {
        const editor = window.__tiptap_editor;
        if (!editor) throw new Error("editor missing");
        const end = editor.state.doc.content.size;
        editor
          .chain()
          .focus()
          .insertContentAt(end, { type: "paragraph" })
          .setTextSelection(end + 1)
          .run();
      });
      await trigger.click();
      await page.getByRole("menuitem", { name: "Table" }).click();
      await expect(dialog).toBeVisible();
    };

    await openGrid();
    await expect(dialog.getByRole("status")).toHaveText(HINT, {
      timeout: 10_000,
    });
    await expect(dialog.getByRole("button")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expectEditorAlive(page, "afterInsert");

    await restore();
    await openGrid();
    await expect(
      dialog.getByRole("button", { name: "3 by 3 table" }),
    ).toBeVisible();
  });

  test("a bubble chunk that 404s leaves the editor working", async ({
    page,
  }) => {
    await failChunk(page, CHUNK_MARKERS.bubble);
    await openToolbarTestDoc(page);
    await page.keyboard.type("Some words to select");
    await page.keyboard.press("Shift+Home");
    await page.waitForTimeout(1_500);
    await expect(page.locator("[data-smart-bubble]")).toHaveCount(0);
    await expectNoVisibleHint(page);
    await expectEditorAlive(page, "afterBubble");
  });
  test("a palette chunk that 404s leaves the editor working; the next Alt+/ loads it", async ({
    page,
  }) => {
    const restore = await failChunk(page, CHUNK_MARKERS.palette);
    await openToolbarTestDoc(page);
    const palette = page.locator("[data-command-palette]");
    await page.keyboard.press("Alt+Slash");
    await page.waitForTimeout(1_500);
    await expect(palette).toHaveCount(0);
    await expectNoVisibleHint(page);
    // Focus never left the document.
    await expect(page.locator(".tiptap")).toBeFocused();
    await expectEditorAlive(page, "afterPalette");

    await restore();
    await page.keyboard.press("Alt+Slash");
    await expect(palette).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Search actions" }),
    ).toBeFocused();
  });

  test("an E engine chunk that 404s leaves the editor and the palette working", async ({
    page,
  }) => {
    const restore = await failChunk(page, CHUNK_MARKERS.engine);
    await openToolbarTestDoc(page);
    await expectEditorAlive(page, "afterEngine");
    const repeatRow = page
      .locator(
        '[data-command-palette] [cmdk-item][data-action-id="repeat.apply"]',
      )
      .last();
    await page.keyboard.press("Alt+Slash");
    await page.keyboard.type("repeat formatting");
    // Loading is never a state the user sees (design pass §6).
    await expect(repeatRow).toBeVisible();
    await expect(repeatRow).not.toContainText("still loading");
    await page.keyboard.press("Escape");

    // Back online: the next palette open fetches the engine again.
    await restore();
    await page.keyboard.press("Alt+Slash");
    await page.keyboard.type("repeat formatting");
    await expect(repeatRow).toContainText("Nothing to repeat yet");
    await page.keyboard.press("Escape");
  });
});
