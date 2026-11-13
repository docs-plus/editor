/**
 * Outline below 950px (spec §4.6, D2 Decision 5, Review Focus 5): an
 * overlay that never opens on load, slides over the page without moving
 * it, closes after a heading pick, and returns focus on Esc or the scrim.
 * Crossing 950px keeps focus. The docked state (M6) survives reload and
 * "Forget my choices".
 */
import { expect, type Page, test } from "@playwright/test";

import { EditorPage } from "./helpers/editor-page";

const UI_KEY = "tinydocy-ui";
const rememberOutline = (open: boolean) =>
  JSON.stringify({
    v: 1,
    slots: { outlineOpen: { last: open, recent: [] } },
  });

const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "Outline", exact: true });
const viewMenu = (page: Page) =>
  page.locator('[data-toolbar-group="view"]').getByRole("button", {
    name: "View",
    exact: true,
  });
const toggleOutline = (page: Page) =>
  page.getByRole("button", { name: "Toggle outline", exact: true });

/** Title plus 30 H2 sections, each with a paragraph. */
function longDoc() {
  const content: object[] = [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Overlay test" }],
    },
  ];
  for (let i = 1; i <= 30; i += 1) {
    content.push(
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: `Heading ${i}` }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: `Body of section ${i}. `.repeat(12) }],
      },
    );
  }
  return { type: "doc", content };
}

async function open(page: Page, width: number) {
  await page.setViewportSize({ width, height: 800 });
  const editorPage = new EditorPage(page);
  await editorPage.goto();
  await editorPage.waitForSync();
  await editorPage.setContent(longDoc());
  return editorPage;
}

const contentBox = (page: Page) =>
  page.locator(".document-editor-content").boundingBox();

async function openOverlayFromMenu(page: Page) {
  await viewMenu(page).click();
  await page.getByRole("menuitemcheckbox", { name: "Outline" }).click();
  await expect(dialog(page)).toBeVisible();
}

test.describe("outline overlay below 950px", () => {
  test("overlay never opens on load", async ({ page }) => {
    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [UI_KEY, rememberOutline(true)],
    );
    await open(page, 900);
    await expect(page.locator(".toc-sidebar")).toHaveCount(0);
    await expect(dialog(page)).toHaveCount(0);
    // The page stays centred: no outline pushed it aside.
    const box = await contentBox(page);
    expect(box).not.toBeNull();
    if (box) {
      const centre = box.x + box.width / 2;
      expect(Math.abs(centre - 450)).toBeLessThanOrEqual(8);
    }
  });

  test("slides over the page and closes after picking a heading", async ({
    page,
  }) => {
    await open(page, 900);
    const before = await contentBox(page);
    await openOverlayFromMenu(page);
    // Focus moved into the overlay (the active item, else the first).
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            document.activeElement?.closest('[role="dialog"]') !== null &&
            document.activeElement?.classList.contains("toc-sidebar-item"),
        ),
      )
      .toBe(true);
    const during = await contentBox(page);
    expect(during?.x).toBe(before?.x);
    expect(during?.width).toBe(before?.width);

    await dialog(page)
      .locator(".toc-sidebar-item", { hasText: /^Heading 20$/ })
      .click();
    await expect(dialog(page)).toHaveCount(0);

    const heading = page.locator(".tiptap h2", { hasText: /^Heading 20$/ });
    await expect(heading).toBeInViewport();
    // The caret sits at the end of the picked heading, in the editor.
    const caret = await page.evaluate(() => {
      const editor = window.__tiptap_editor;
      if (!editor) return null;
      const { $head } = editor.state.selection;
      return {
        text: $head.parent.textContent,
        atEnd: $head.parentOffset === $head.parent.content.size,
        focused: editor.view.hasFocus(),
      };
    });
    expect(caret).toEqual({ text: "Heading 20", atEnd: true, focused: true });
  });

  test("Esc and the scrim close it and return focus to the trigger", async ({
    page,
  }) => {
    await open(page, 900);
    await openOverlayFromMenu(page);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(document.activeElement?.closest(".outline-panel")),
        ),
      )
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(viewMenu(page)).toBeFocused();

    await openOverlayFromMenu(page);
    await page
      .getByRole("button", { name: "Close outline" })
      .click({ position: { x: 600, y: 300 } });
    await expect(dialog(page)).toHaveCount(0);
    await expect(viewMenu(page)).toBeFocused();
  });

  test("Esc during a keyboard drag cancels the drag, not the overlay", async ({
    page,
  }) => {
    await open(page, 900);
    await openOverlayFromMenu(page);
    const handle = dialog(page)
      .getByRole("button", { name: "Drag to reorder" })
      .first();
    await handle.focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeVisible();
  });

  test("crossing 950 keeps focus", async ({ page }) => {
    await open(page, 900);
    await openOverlayFromMenu(page);
    const item = dialog(page).locator(".toc-sidebar-item", {
      hasText: /^Heading 3$/,
    });
    await item.focus();
    await page.setViewportSize({ width: 1200, height: 800 });
    // Docked again with the remembered (default open) state.
    await expect(dialog(page)).toHaveCount(0);
    await expect(page.locator(".toc-sidebar")).toBeVisible();
    await expect(
      page.locator(".toc-sidebar-item", { hasText: /^Heading 3$/ }),
    ).toBeFocused();
  });

  test("crossing 950 into a closed docked outline focuses its toggle", async ({
    page,
  }) => {
    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key, value),
      [UI_KEY, rememberOutline(false)],
    );
    await open(page, 900);
    await openOverlayFromMenu(page);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Boolean(document.activeElement?.closest(".outline-panel")),
        ),
      )
      .toBe(true);
    await page.setViewportSize({ width: 1200, height: 800 });
    await expect(page.locator(".toc-sidebar")).toHaveCount(0);
    await expect(toggleOutline(page)).toBeFocused();
  });
});

test.describe("docked outline state (M6)", () => {
  test("survives reload and Forget my choices", async ({ page }) => {
    await open(page, 1280);
    await expect(page.locator(".toc-sidebar")).toBeVisible();
    await toggleOutline(page).click();
    await expect(page.locator(".toc-sidebar")).toHaveCount(0);

    await page.reload();
    await new EditorPage(page).waitForSync();
    await expect(page.locator(".toc-sidebar")).toHaveCount(0);

    await page.getByRole("button", { name: "More formatting" }).click();
    await page.getByRole("menuitem", { name: "Forget my choices" }).click();
    await page.reload();
    await new EditorPage(page).waitForSync();
    await expect(page.locator(".toc-sidebar")).toHaveCount(0);
  });
});
