import { expect, type Page, test } from "@playwright/test";

import { EditorPage } from "./helpers/editor-page";
import {
  activeOutlineRow,
  editorScrollTops,
  settledEditorScrollTop,
} from "./helpers/outline";

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

/** Title plus `count` H2 sections, each with two short paragraphs. */
function longDoc(count: number) {
  const content: object[] = [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Long document" }],
    },
  ];
  for (let n = 1; n <= count; n++) {
    content.push(
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: `Section ${n}` }],
      },
      { type: "paragraph", content: [{ type: "text", text: `Body ${n} a` }] },
      { type: "paragraph", content: [{ type: "text", text: `Body ${n} b` }] },
    );
  }
  return { type: "doc", content };
}

const toolbarBottom = (page: Page) =>
  page
    .locator('[role="toolbar"][data-variant="fixed"]')
    .evaluate((el) => el.getBoundingClientRect().bottom);

test.describe("TOC sidebar follows the page", () => {
  test.beforeEach(async ({ page }) => {
    const editorPage = new EditorPage(page);
    await editorPage.goto();
    await editorPage.waitForSync();
    await editorPage.setContent(longDoc(60));
    await expect(
      page.locator(".toc-sidebar-item", { hasText: /^Section 60$/ }),
    ).toHaveCount(1);
  });

  test("after a pick the active row is scrolled into the outline, and the page stays put", async ({
    page,
  }) => {
    // Put "Section 40" at the top of the outline's box and pick it. The
    // outline centres the heading, so the active row (the heading now at
    // the top of the page) is one the outline has scrolled past.
    const pick = page.locator(".toc-sidebar-item", {
      hasText: /^Section 40$/,
    });
    await pick.evaluate((row) => {
      const list = row.closest(".toc-sidebar");
      if (!list) return;
      list.scrollTop +=
        row.getBoundingClientRect().top - list.getBoundingClientRect().top;
    });
    await pick.click();
    await page.waitForTimeout(100); // the jump starts a frame later
    const settled = await settledEditorScrollTop(page);

    await expect
      .poll(() => activeOutlineRow(page))
      .toEqual({ text: expect.stringMatching(/^Section 3\d$/), inView: true });
    // Only the outline scrolled: the page stays where the jump left it.
    await page.waitForTimeout(300);
    expect(new Set([settled, ...(await editorScrollTops(page))])).toEqual(
      new Set([settled]),
    );
    const heading = await page
      .locator(".tiptap h2", { hasText: /^Section 40$/ })
      .boundingBox();
    expect(heading?.y ?? 0).toBeGreaterThan(await toolbarBottom(page));
    expect(heading?.y ?? Infinity).toBeLessThan(
      page.viewportSize()?.height ?? 0,
    );
  });

  test("the outline never sits under the sticky toolbar", async ({ page }) => {
    await page
      .locator(".tiptap h2", { hasText: /^Section 30$/ })
      .evaluate((el) => el.scrollIntoView({ block: "start" }));
    // The outline's box (its rows scroll inside it) starts below the row.
    const outline = await page.locator(".toc-sidebar").boundingBox();
    expect(outline?.y ?? 0).toBeGreaterThanOrEqual(await toolbarBottom(page));
  });
});
