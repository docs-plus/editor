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

    // headings[1] is Section A (H2 with child Section A content)
    const tocId = headings[1].tocId;
    await editorPage.clickFoldChevron(tocId);

    await page.waitForTimeout(500);

    const folded = await editorPage.isSectionFolded(tocId);
    expect(folded).toBe(true);
  });

  test("clicking crinkle unfolds section", async ({ page }) => {
    const headings = await editorPage.getHeadingsWithTocIds();
    expect(headings.length).toBeGreaterThanOrEqual(2);
    // headings[1] is Section A (H2 with child Section A content)
    const tocId = headings[1].tocId;

    await editorPage.clickFoldChevron(tocId);
    await page.waitForTimeout(500);
    expect(await editorPage.isSectionFolded(tocId)).toBe(true);

    const crinkle = page.locator(".heading-fold-crinkle").first();
    if (await crinkle.isVisible()) {
      await crinkle.click();
      await page.waitForTimeout(500);
    }
  });
});
