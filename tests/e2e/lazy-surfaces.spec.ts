/**
 * Lazy surface chunks that fail to load (offline, or a deploy replaced
 * them) leave the editor and the tab strip mounted and typing working; a
 * popup names what did not load, with Retry (design pass §12), and Retry
 * or the next open fetches the chunk again. The palette says it could not
 * open.
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

const hint = (name: string) => `Couldn’t load ${name}.Retry`;
const PALETTE_FAILED =
  "Couldn’t open actions. Check your connection and try again.";

/** No failure hint on screen: the bubble just stays away. */
const expectNoVisibleHint = (page: Page) =>
  expect(
    page.getByText(/^Couldn’t (load|open)/).filter({ visible: true }),
  ).toHaveCount(0);

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
    await expect(dialog.getByRole("status")).toHaveText(hint("colours"));
    // Only Retry: no swatch arrived.
    await expect(dialog.getByRole("button")).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: "Retry" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expectEditorAlive(page, "afterColour");

    // Back online: the next open fetches the chunk again.
    await restore();
    await chevron.click();
    await expect(dialog.getByRole("button").first()).toBeVisible();
    await expect(dialog.getByRole("status")).toHaveCount(0);
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
    await expect(dialog.getByRole("status")).toHaveText(
      hint("the table picker"),
      { timeout: 10_000 },
    );
    await expect(dialog.getByRole("button")).toHaveCount(1);
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
    // Never silent (design pass §8): the status pill says why, with Retry,
    // and the live region reads it.
    const pill = page.locator('[data-status-pill="desktop"]');
    await expect(pill).toContainText(PALETTE_FAILED, { timeout: 10_000 });
    await expect(
      page.getByRole("status").filter({ hasText: PALETTE_FAILED }),
    ).toHaveCount(1);
    await expect(
      page.getByRole("alert").filter({ hasText: PALETTE_FAILED }),
    ).toHaveCount(0);
    await expect(palette).toHaveCount(0);
    // Focus never left the document.
    await expect(page.locator(".tiptap")).toBeFocused();
    await expectEditorAlive(page, "afterPalette");

    // Back online: the next Alt+/ opens it.
    await restore();
    await page.keyboard.press("Alt+Slash");
    await expect(palette).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Search actions" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
  });

  test("Retry on the palette's failure pill opens it", async ({ page }) => {
    const restore = await failChunk(page, CHUNK_MARKERS.palette);
    await openToolbarTestDoc(page);
    await page.keyboard.press("Alt+Slash");
    const pill = page.locator('[data-status-pill="desktop"]');
    await expect(pill).toContainText(PALETTE_FAILED, { timeout: 10_000 });
    await restore();
    await pill.getByRole("button", { name: /^Retry/ }).click();
    await expect(page.locator("[data-command-palette]")).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Search actions" }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
  });

  test("Retry in the colour popover fetches the chunk again in place", async ({
    page,
  }) => {
    const restore = await failChunk(page, CHUNK_MARKERS.colorPanel);
    await openToolbarTestDoc(page);
    await row(page)
      .getByRole("button", { name: "More text colours" })
      .first()
      .click();
    const dialog = page.getByRole("dialog", { name: "Text colours" });
    const retry = dialog.getByRole("button", { name: "Retry" });
    await expect(retry).toBeVisible({ timeout: 10_000 });
    // The icon is muted, never red: nothing the writer did is wrong.
    const colours = await dialog.getByRole("status").evaluate((el) => ({
      icon: getComputedStyle(el.querySelector("svg") as Element).color,
      text: getComputedStyle(el).color,
    }));
    expect(colours.icon).not.toBe(colours.text);

    await restore();
    await retry.click();
    await expect(
      dialog.getByRole("button", { name: "Red text" }),
    ).toBeVisible();
    await expect(dialog.getByRole("status")).toHaveCount(0);
  });

  test("a brush click whose engine chunk 404s says so, with Retry", async ({
    page,
  }) => {
    const restore = await failChunk(page, CHUNK_MARKERS.engine);
    await openToolbarTestDoc(page);
    await typeInNewParagraphAtEnd(page, "paint me");
    await page.keyboard.press("Shift+Home");
    const brush = page
      .getByRole("toolbar", { name: "Selection formatting" })
      .getByRole("button", { name: "Paint format" });
    await brush.click();
    const pill = page.locator('[data-status-pill="desktop"]');
    await expect(pill).toContainText("Couldn’t load formatting tools.");
    await expect(page.getByText("still loading")).toHaveCount(0);

    // Back online: Retry fetches the engine and runs the click.
    await restore();
    await pill.getByRole("button", { name: /^Retry/ }).click();
    // The click kept the editor's focus and selection, and the bubble.
    await expect(brush).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(".document-editor-content")).toHaveClass(
      /is-painting/,
    );
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
