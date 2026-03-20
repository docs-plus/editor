import { expect, test } from "@playwright/test";

import { EditorPage } from "./helpers/editor-page";

const TOC_DOC_CONTENT = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Test Document" }],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "First Section" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "Content for First Section" }],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Second Section" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "Content for Second Section" }],
    },
  ],
};

test.describe("TOC sidebar", () => {
  let editorPage: EditorPage;

  test.beforeEach(async ({ page }) => {
    editorPage = new EditorPage(page);
    await editorPage.goto();
    await editorPage.waitForSync();
    await editorPage.setContent(TOC_DOC_CONTENT);
    await page.waitForTimeout(300);
  });

  test("TOC shows all headings", async () => {
    const items = await editorPage.getTocItems();
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  test("clicking TOC item targets the heading", async ({ page }) => {
    await page.locator(".toc-sidebar").waitFor({ state: "visible" });
    await editorPage.clickTocItem("Second Section");
    const secondHeading = page
      .locator(".tiptap h2", { hasText: "Second Section" })
      .first();
    await expect(secondHeading).toBeVisible();
  });
});
