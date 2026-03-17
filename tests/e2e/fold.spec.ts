import { expect, test } from "@playwright/test";

import { EditorPage } from "./helpers/editor-page";

test.describe("heading fold", () => {
  let editorPage: EditorPage;

  test.beforeEach(async ({ page }) => {
    editorPage = new EditorPage(page);
    await editorPage.goto();
    await editorPage.waitForSync();
    await editorPage.buildDocument([
      { level: 1, text: "Test Document" },
      { level: 2, text: "Section A" },
      { level: 3, text: "Section A content" },
      { level: 2, text: "Section B" },
    ]);
  });

  test("fold chevron folds section content", async ({ page }) => {
    const headings = await editorPage.getHeadingsWithTocIds();
    expect(headings.length).toBeGreaterThanOrEqual(2);

    await page.locator(".toc-sidebar").waitFor({ state: "visible" });
    const toggle = page.locator(".toc-sidebar-fold-toggle").first();
    await toggle.waitFor({ state: "visible", timeout: 10000 });

    const row = toggle.locator(
      "xpath=ancestor::div[contains(@class, 'toc-sidebar-item-row')]",
    );
    const tocId = await row.getAttribute("data-toc-id");
    expect(tocId).toBeTruthy();

    await toggle.click();
    await page.waitForTimeout(500);

    const folded = await editorPage.isSectionFolded(tocId!);
    expect(folded).toBe(true);
  });

  test("clicking crinkle unfolds section", async ({ page }) => {
    const headings = await editorPage.getHeadingsWithTocIds();
    expect(headings.length).toBeGreaterThanOrEqual(2);

    await page.locator(".toc-sidebar").waitFor({ state: "visible" });
    const toggle = page.locator(".toc-sidebar-fold-toggle").first();
    await toggle.waitFor({ state: "visible", timeout: 10000 });

    const row = toggle.locator(
      "xpath=ancestor::div[contains(@class, 'toc-sidebar-item-row')]",
    );
    const tocId = await row.getAttribute("data-toc-id");
    expect(tocId).toBeTruthy();

    await toggle.click();
    await page.waitForTimeout(500);
    expect(await editorPage.isSectionFolded(tocId!)).toBe(true);

    const crinkle = page.locator(".heading-fold-crinkle").first();
    if (await crinkle.isVisible()) {
      await crinkle.click();
      await page.waitForTimeout(500);
    }
  });
});
