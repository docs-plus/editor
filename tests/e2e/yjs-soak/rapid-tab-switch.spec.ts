import { expect, test } from "@playwright/test";

import { EditorPage } from "../helpers/editor-page";

test("rapid tab switching preserves document content", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  const docId = `tab-switch-${Date.now()}`;

  const ep = new EditorPage(page);
  await ep.goto(docId);
  await ep.waitForSync();

  await page.click(".tiptap h1");
  await ep.typeText("Initial content for tab test");
  await page.waitForTimeout(1000);

  const newTabBtn = page.locator(".tab-bar-new");

  for (let i = 0; i < 10; i++) {
    await newTabBtn.click();
    await page.waitForTimeout(200);
  }

  const originalTab = page
    .locator(".tab-bar-tab")
    .filter({ hasText: "Initial content" });
  await originalTab.click();
  await page.waitForTimeout(2000);

  await page.waitForSelector(".tiptap[contenteditable='true']", {
    timeout: 10000,
  });

  const json = await ep.getEditorJSON();
  const textContent = JSON.stringify(json);
  expect(textContent).toContain("Initial content for tab test");

  const wsErrors = consoleErrors.filter(
    (e) => e.includes("WebSocket") || e.includes("duplicate"),
  );
  expect(wsErrors).toHaveLength(0);
});
