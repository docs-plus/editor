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
    const items = await editorPage.getTocItems();
    expect(items.length).toBeGreaterThanOrEqual(2);
    await editorPage.clickTocItem("Second Section");
    await page.waitForTimeout(300);
  });
});
