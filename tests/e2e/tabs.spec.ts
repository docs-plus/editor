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
    // Reaching the cap mounts an editor per tab (49 by default), which takes
    // several times longer on a loaded CI runner than locally.
    test.setTimeout(60_000);
    const ep = new EditorPage(page);
    await ep.goto();
    await ep.waitForSync();

    const newTabBtn = page.locator(".tab-bar-new");
    const tabs = page.locator(".tab-bar-tab");
    // Each click mounts a new editor, so wait for the tab it adds rather than
    // a fixed sleep: under CI load the sleeps alone pushed this test past its
    // timeout, and a click slower than the sleep ended the loop early.
    for (let i = 0; i < 60; i++) {
      if (await newTabBtn.isDisabled()) break;
      const beforeCount = await tabs.count();
      await newTabBtn.click();
      await expect(tabs).toHaveCount(beforeCount + 1);
    }

    await expect(newTabBtn).toBeDisabled();
    await expect(newTabBtn).toHaveAttribute("title", /Maximum tabs reached/);

    const cappedCount = await tabs.count();
    const cap = Number(
      (await newTabBtn.getAttribute("title"))?.match(/\((\d+)\)/)?.[1],
    );
    expect(cappedCount).toBe(cap);

    // Nothing should happen, so there is no condition to wait for.
    await page.keyboard.press("Control+t");
    await page.waitForTimeout(300);
    await expect(tabs).toHaveCount(cappedCount);
  });
});
