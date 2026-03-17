import { expect, test } from "@playwright/test";

import { EditorPage } from "./helpers/editor-page";

test.describe("heading drag", () => {
  let editorPage: EditorPage;

  test.beforeEach(async ({ page }) => {
    editorPage = new EditorPage(page);
    await editorPage.goto();
    await editorPage.waitForSync();
    await editorPage.buildDocument([
      { level: 1, text: "Test Document" },
      { level: 2, text: "Section A" },
      { level: 2, text: "Section B" },
    ]);
  });

  test("hovering heading shows drag handle", async ({ page }) => {
    const headings = await editorPage.getHeadingsWithTocIds();
    expect(headings.length).toBeGreaterThanOrEqual(2);
    const tocId = headings[1].tocId;

    const heading = page.locator(`.tiptap [data-toc-id="${tocId}"]`);
    await heading.hover();

    const handle = page.locator(".heading-drag-handle");
    await expect(handle).toBeVisible({ timeout: 2000 });
  });
});
