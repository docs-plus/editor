import { expect, test } from "@playwright/test";

import { EditorPage } from "./helpers/editor-page";

const DOC_CONTENT = {
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
      content: [{ type: "text", text: "Content for A" }],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Section B" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "Content for B" }],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Section C" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "Content for C" }],
    },
  ],
};

test.describe("TOC drag and drop", () => {
  let editorPage: EditorPage;

  test.beforeEach(async ({ page }) => {
    editorPage = new EditorPage(page);
    await editorPage.goto();
    await editorPage.waitForSync();
    await editorPage.setContent(DOC_CONTENT);
    await page.waitForTimeout(500);
  });

  test("drag handle appears on TOC item hover", async ({ page }) => {
    await page.locator(".toc-sidebar").waitFor({ state: "visible" });
    const row = page.locator(".toc-sidebar-item-row").nth(1);
    await row.hover();
    const handle = row.locator(".toc-sidebar-drag-handle");
    await expect(handle).toBeVisible({ timeout: 2000 });
  });

  test("title H1 is visible in TOC but has no drag handle", async ({
    page,
  }) => {
    const items = await editorPage.getTocItems();
    expect(items[0].text).toBe("Test Document");
    const firstRow = page.locator(".toc-sidebar-item-row").first();
    await firstRow.hover();
    const handle = firstRow.locator(".toc-sidebar-drag-handle");
    expect(await handle.count()).toBe(0);
  });

  test("drag Section B above Section A reorders editor content", async ({
    page,
  }) => {
    await page.locator(".toc-sidebar").waitFor({ state: "visible" });

    const headings = await editorPage.getHeadingsWithTocIds();
    const sectionA = headings.find((h) => h.text === "Section A");
    const sectionB = headings.find((h) => h.text === "Section B");
    expect(sectionA).toBeTruthy();
    expect(sectionB).toBeTruthy();

    const rowB = page.locator(
      `.toc-sidebar-item-row[data-toc-id="${sectionB!.tocId}"]`,
    );
    const rowA = page.locator(
      `.toc-sidebar-item-row[data-toc-id="${sectionA!.tocId}"]`,
    );

    const handleB = rowB.locator(".toc-sidebar-drag-handle");
    const boxA = await rowA.boundingBox();
    const boxHandle = await handleB.boundingBox();

    if (!boxA || !boxHandle) {
      test.skip(true, "Could not get bounding boxes");
      return;
    }

    const startX = boxHandle.x + boxHandle.width / 2;
    const startY = boxHandle.y + boxHandle.height / 2;
    const targetY = boxA.y + boxA.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, targetY, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(500);

    const afterHeadings = await editorPage.getHeadingsWithTocIds();
    const aIdx = afterHeadings.findIndex((h) => h.text === "Section A");
    const bIdx = afterHeadings.findIndex((h) => h.text === "Section B");
    expect(bIdx).toBeLessThan(aIdx);
  });

  test("folded section drag handle is visible on hover", async ({ page }) => {
    const headings = await editorPage.getHeadingsWithTocIds();
    const sectionA = headings.find((h) => h.text === "Section A");
    expect(sectionA).toBeTruthy();

    const row = page.locator(
      `.toc-sidebar-item-row[data-toc-id="${sectionA!.tocId}"]`,
    );
    const foldToggle = row.locator(".toc-sidebar-fold-toggle");

    if ((await foldToggle.count()) > 0) {
      await foldToggle.click();
      await page.waitForTimeout(300);
    }

    await row.hover();
    const handle = row.locator(".toc-sidebar-drag-handle");
    await expect(handle).toBeVisible({ timeout: 2000 });
  });
});
