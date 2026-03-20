import { expect, test } from "@playwright/test";

import { EditorPage } from "./helpers/editor-page";

const FOLD_DOC_CONTENT = {
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
      content: [{ type: "text", text: "Section A" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "Section A paragraph" }],
    },
    {
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "Section A.1" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "Nested section content" }],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Section B" }],
    },
  ],
};

test.describe("heading fold", () => {
  let editorPage: EditorPage;

  test.beforeEach(async ({ page }) => {
    editorPage = new EditorPage(page);
    await editorPage.goto();
    await editorPage.waitForSync();
    await editorPage.setContent(FOLD_DOC_CONTENT);
    await page.waitForTimeout(500);
  });

  test("fold chevron folds section content", async ({ page }) => {
    await page.locator(".toc-sidebar").waitFor({ state: "visible" });
    await expect
      .poll(async () => page.locator(".toc-sidebar-fold-toggle").count(), {
        timeout: 15000,
      })
      .toBeGreaterThan(0);
    const toggle = page.locator(".toc-sidebar-fold-toggle").first();
    await expect(toggle).toBeVisible({ timeout: 10000 });

    await toggle.click();
    const sectionAHeading = page
      .locator(".tiptap h2", { hasText: "Section A" })
      .first();
    await expect(sectionAHeading).toHaveClass(/heading-section-folded/);
  });

  test("clicking crinkle unfolds section", async ({ page }) => {
    await page.locator(".toc-sidebar").waitFor({ state: "visible" });
    const row = page
      .locator(".toc-sidebar-item-row", { hasText: "Section A" })
      .first();
    await row.waitFor({ state: "visible", timeout: 10000 });
    await row.scrollIntoViewIfNeeded();
    const toggle = row.locator(".toc-sidebar-fold-toggle");
    await expect(toggle).toBeVisible({ timeout: 10000 });
    const sectionAHeading = page
      .locator(".tiptap h2", { hasText: "Section A" })
      .first();

    await toggle.click();
    await expect(sectionAHeading).toHaveClass(/heading-section-folded/);

    const crinkle = page.locator(".heading-fold-crinkle").first();
    await expect(crinkle).toBeVisible();
    await crinkle.click();
    await expect(sectionAHeading).not.toHaveClass(/heading-section-folded/);
  });
});
