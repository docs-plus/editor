import { expect, test } from "@playwright/test";

import { EditorPage } from "../helpers/editor-page";

test.describe("yjs reconnection recovery", () => {
  test("editor recovers from temporary network loss without data loss", async ({
    page,
  }) => {
    const ep = new EditorPage(page);
    await ep.goto();
    await ep.waitForSync();

    await page.click(".tiptap");
    await ep.typeText("Hello before crash");
    await page.waitForTimeout(1000);

    await page.context().setOffline(true);
    await ep.typeText(" — offline edit");
    await page.waitForTimeout(1000);

    await page.context().setOffline(false);
    await page.waitForTimeout(5000);

    const afterJson = await ep.getEditorJSON();
    const textContent = JSON.stringify(afterJson);
    expect(textContent).toContain("Hello before crash");
    expect(textContent).toContain("offline edit");
  });
});
