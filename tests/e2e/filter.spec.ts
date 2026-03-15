import { expect, test } from "@playwright/test";
import { EditorPage } from "./helpers/editor-page";

test.describe("heading filter", () => {
  let editorPage: EditorPage;

  test.beforeEach(async ({ page }) => {
    editorPage = new EditorPage(page);
    await editorPage.goto();
    await editorPage.waitForSync();
    await editorPage.buildDocument([
      { level: 1, text: "Test Document" },
      { level: 2, text: "Alpha Section" },
      { level: 2, text: "Beta Section" },
      { level: 2, text: "Gamma Section" },
    ]);
  });

  test("CMD+SHIFT+F opens filter panel", async ({ page }) => {
    await editorPage.openFilter();
    const panel = page.locator(".filter-panel");
    await expect(panel).toBeVisible({ timeout: 2000 });
  });

  test("typing filter query highlights matches", async ({ page }) => {
    await editorPage.openFilter();
    await editorPage.typeFilter("Alpha");
    // Filter highlights are debounced; wait for match
    await page.waitForTimeout(400);

    const highlights = page.locator(".heading-filter-highlight");
    await expect(highlights.first()).toBeVisible({ timeout: 2000 });
  });
});
