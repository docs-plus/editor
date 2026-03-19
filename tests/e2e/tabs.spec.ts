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

  test("create tab is blocked when cap is reached", async ({ page }) => {
    const ep = new EditorPage(page);
    await ep.goto();
    await ep.waitForSync();

    const newTabBtn = page.locator(".tab-bar-new");
    for (let i = 0; i < 60; i++) {
      if (await newTabBtn.isDisabled()) break;
      const beforeCount = await page.locator(".tab-bar-tab").count();
      await newTabBtn.click();
      await page.waitForTimeout(120);
      const afterCount = await page.locator(".tab-bar-tab").count();
      if (afterCount === beforeCount) break;
    }

    await expect(newTabBtn).toBeDisabled();
    await expect(newTabBtn).toHaveAttribute("title", /Maximum tabs reached/);

    const cappedCount = await page.locator(".tab-bar-tab").count();
    await page.keyboard.press("Control+t");
    await page.waitForTimeout(300);
    await expect(page.locator(".tab-bar-tab")).toHaveCount(cappedCount);
  });
});
