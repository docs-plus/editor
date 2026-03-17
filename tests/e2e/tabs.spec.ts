import { expect, test } from "@playwright/test";
import { EditorPage } from "./helpers/editor-page";

test.describe("tabs", () => {
  test("regenerate button produces new content on Playground", async ({
    page,
  }) => {
    const ep = new EditorPage(page);
    await ep.goto();
    await ep.waitForSync();

    await page.locator(`[data-tab-id="playground"]`).click();
    await page.waitForTimeout(500);

    const jsonBefore = await ep.getEditorJSON();
    const textBefore = JSON.stringify(jsonBefore);

    const regenerateBtn = page.locator(".tab-bar-tab-regenerate");
    await regenerateBtn.click();
    await page.waitForTimeout(1000);

    const jsonAfter = await ep.getEditorJSON();
    const textAfter = JSON.stringify(jsonAfter);

    expect(textBefore).not.toEqual(textAfter);
  });

  test("close-all is enabled when user tabs exist", async ({ page }) => {
    const ep = new EditorPage(page);
    await ep.goto();
    await ep.waitForSync();

    const closeAllBtn = page.locator(".tab-bar-close-all");
    await expect(closeAllBtn).toBeEnabled();
  });

  test("new tab adds tab to bar", async ({ page }) => {
    const ep = new EditorPage(page);
    await ep.goto();
    await ep.waitForSync();

    const tabsBefore = page.locator(".tab-bar-tab");
    const countBefore = await tabsBefore.count();

    const newTabBtn = page.locator(".tab-bar-new");
    await newTabBtn.click();
    await page.waitForTimeout(500);

    const tabsAfter = page.locator(".tab-bar-tab");
    await expect(tabsAfter).toHaveCount(countBefore + 1);
  });
});
