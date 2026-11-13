/**
 * Insert memory (spec §5): the M10 face shows the last inserted kind at T1
 * only (a fresh profile keeps "+ Insert"), and the M17a table grid opens
 * at the last size, across reloads, until "Forget my choices".
 */
import { expect, type Page, test } from "@playwright/test";

import { openToolbarTestDoc } from "./helpers/a11y";
import { EditorPage } from "./helpers/editor-page";

const row = (page: Page) =>
  page.locator('[role="toolbar"][data-variant="fixed"]');
const insertGroup = (page: Page) =>
  row(page).locator('[data-toolbar-group="insert"]');
const insertTrigger = (page: Page) =>
  insertGroup(page).getByRole("button", { name: "Insert", exact: true });
const face = (page: Page) =>
  insertGroup(page).locator('[data-action-id^="insert."]');

/** Caret at the end of a new paragraph after the title. */
async function caretInBody(page: Page) {
  await page.evaluate(() => {
    const editor = window.__tiptap_editor;
    if (!editor) throw new Error("editor missing");
    editor
      .chain()
      .focus()
      .insertContentAt(editor.state.doc.content.size, {
        type: "paragraph",
        content: [{ type: "text", text: "body" }],
      })
      .setTextSelection(editor.state.doc.content.size - 1)
      .run();
  });
}

const countNodes = (page: Page, name: string) =>
  page.evaluate((type) => {
    let count = 0;
    window.__tiptap_editor?.state.doc.descendants((node) => {
      if (node.type.name === type) count += 1;
    });
    return count;
  }, name);

test.describe("M10: Insert face", () => {
  test("a fresh profile shows '+ Insert' and no face", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openToolbarTestDoc(page);
    await expect(insertTrigger(page)).toContainText("Insert");
    await expect(face(page)).toHaveCount(0);
  });

  test("the last kind becomes a T1 face that inserts it again", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openToolbarTestDoc(page);
    await caretInBody(page);
    await insertTrigger(page).click();
    await page.getByRole("menuitem", { name: "Code block" }).click();
    expect(await countNodes(page, "codeBlock")).toBe(1);

    const codeFace = insertGroup(page).getByRole("button", {
      name: "Code block",
      exact: true,
    });
    await expect(codeFace).toBeVisible();
    await expect(codeFace).toContainText("Code block");
    // The trigger is only the face's chevron at T1.
    await expect(insertGroup(page).locator(".st-insert-label")).toBeHidden();

    await caretInBody(page);
    await codeFace.click();
    expect(await countNodes(page, "codeBlock")).toBe(2);

    // From T2 the face goes; the plain menu pre-highlights the kind.
    await page.setViewportSize({ width: 1100, height: 900 });
    await expect(codeFace).toBeHidden();
    await expect(insertTrigger(page)).toBeVisible();
    await insertTrigger(page).click();
    await expect(
      page.locator('[data-action-id="insert.codeBlock"][data-last]'),
    ).toBeVisible();
  });
});

test.describe("M17a: table size", () => {
  test("the grid reopens at the last size until Forget", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const editorPage = await openToolbarTestDoc(page);
    await caretInBody(page);

    const openGrid = async () => {
      await insertTrigger(page).click();
      await page.getByRole("menuitem", { name: "Table" }).click();
      await expect(
        page.getByRole("dialog", { name: "Insert table" }),
      ).toBeVisible();
    };
    const focusedCell = () =>
      page.evaluate(() => {
        const cell = document.activeElement as HTMLElement | null;
        return cell?.getAttribute("aria-label") ?? null;
      });

    await openGrid();
    // The first visit opens at the default 3×3.
    await expect.poll(focusedCell).toBe("3 by 3 table");
    await page.getByRole("button", { name: "2 by 4 table" }).click();
    expect(await countNodes(page, "table")).toBe(1);

    await caretInBody(page);
    await openGrid();
    await expect.poll(focusedCell).toBe("2 by 4 table");
    await page.keyboard.press("Escape");

    await page.reload();
    await editorPage.waitForSync();
    await caretInBody(page);
    await openGrid();
    await expect.poll(focusedCell).toBe("2 by 4 table");
    await page.keyboard.press("Escape");

    await row(page).getByRole("button", { name: "More formatting" }).click();
    await page.getByRole("menuitem", { name: "Forget my choices" }).click();
    await caretInBody(page);
    await openGrid();
    await expect.poll(focusedCell).toBe("3 by 3 table");
  });
});

/**
 * The ladder queries the row's content box. Sets the viewport so that box
 * is exactly `threshold` wide (the narrowest T1, A5) with the widest face
 * ("Code block") remembered, and checks the row still fits.
 */
async function expectWidestFaceFitsAt(page: Page, threshold: number) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "tinydocy-choices",
      JSON.stringify({
        v: 1,
        slots: { insertKind: { last: "codeBlock", recent: [] } },
      }),
    );
  });
  const probe = threshold + 100;
  await page.setViewportSize({ width: probe, height: 900 });
  await new EditorPage(page).goto();
  const inline = await row(page).evaluate((el) => {
    const style = getComputedStyle(el);
    return (
      el.clientWidth -
      Number.parseFloat(style.paddingLeft) -
      Number.parseFloat(style.paddingRight)
    );
  });
  await page.setViewportSize({
    width: probe - (inline - threshold),
    height: 900,
  });
  await expect(face(page)).toBeVisible();
  const fit = await row(page).evaluate((el) => ({
    scroll: el.scrollWidth,
    client: el.clientWidth,
  }));
  expect(fit.scroll).toBeLessThanOrEqual(fit.client + 1);
}

/** Mouse and touch T2 thresholds (`smart-toolbar.scss`, contract A5/A6). */
const T2_MOUSE = 1264;
const T2_TOUCH = 1560;

test("mouse: the widest face fits where T1 starts", async ({ page }) => {
  await expectWidestFaceFitsAt(page, T2_MOUSE);
});

test.describe("touch", () => {
  test.use({ hasTouch: true });

  test("the widest face fits where T1 starts", async ({ page }) => {
    await expectWidestFaceFitsAt(page, T2_TOUCH);
  });
});
