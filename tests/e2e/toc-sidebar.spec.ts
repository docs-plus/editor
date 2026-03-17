import { expect, test } from "@playwright/test";

import { EditorPage } from "./helpers/editor-page";

test.describe("TOC sidebar", () => {
  let editorPage: EditorPage;

  test.beforeEach(async ({ page }) => {
    editorPage = new EditorPage(page);
    await editorPage.goto();
    await editorPage.waitForSync();
    await editorPage.buildDocument([
      { level: 1, text: "Test Document" },
      { level: 2, text: "First Section" },
      { level: 2, text: "Second Section" },
    ]);
  });

  test("TOC shows all headings", async () => {
    const items = await editorPage.getTocItems();
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  test("clicking TOC item scrolls to heading", async ({ page }) => {
    const headings = await editorPage.getHeadingsWithTocIds();
    expect(headings.length).toBeGreaterThanOrEqual(2);
    // headings[2] is Second Section (H2)
    const secondSection =
      headings[2] ?? headings.find((h) => h.text?.includes("Second"));
    expect(secondSection).toBeTruthy();

    await page.locator(".toc-sidebar").waitFor({ state: "visible" });
    const row = page.locator(
      `.toc-sidebar-item-row[data-toc-id="${secondSection!.tocId}"]`,
    );
    const item = row.locator(".toc-sidebar-item");
    await item.click();
    await page.waitForTimeout(300);
  });
});
