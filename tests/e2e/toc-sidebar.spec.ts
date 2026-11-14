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

  test("a drop does not pull the outline back to the active row", async ({
    page,
  }) => {
    // Section 2 at the top of the page is active; the outline shows the
    // rows around Section 40, far below it.
    await page
      .locator(".tiptap h2", { hasText: /^Section 2$/ })
      .evaluate((el) => el.scrollIntoView({ block: "start" }));
    await expect
      .poll(async () => (await activeOutlineRow(page))?.text)
      .toBe("Section 2");
    const row = (n: number) =>
      page.locator(".toc-sidebar-item-row", {
        has: page.locator(".toc-sidebar-item", {
          hasText: new RegExp(`^Section ${n}$`),
        }),
      });
    await row(40).evaluate((el) => {
      const list = el.closest(".toc-sidebar");
      if (!list) return;
      list.scrollTop +=
        el.getBoundingClientRect().top -
        list.getBoundingClientRect().top -
        list.clientHeight / 2;
    });
    const outline = page.locator(".toc-sidebar");
    const before = await outline.evaluate((el) => el.scrollTop);

    // Drag Section 41 above Section 40, in the middle of the outline.
    await row(41).hover();
    const handle = await row(41)
      .locator(".toc-sidebar-drag-handle")
      .boundingBox();
    const target = await row(40).boundingBox();
    if (!handle || !target) throw new Error("no rows to drag");
    const x = handle.x + handle.width / 2;
    await page.mouse.move(x, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, target.y + target.height / 4, { steps: 10 });
    await page.mouse.up();
    await expect
      .poll(() =>
        page.evaluate(() =>
          [...document.querySelectorAll(".tiptap h2")]
            .map((h) => h.textContent)
            .slice(38, 41),
        ),
      )
      .toEqual(["Section 39", "Section 41", "Section 40"]);
    await page.waitForTimeout(400); // the outline's next rebuild

    expect(await outline.evaluate((el) => el.scrollTop)).toBe(before);
    expect((await activeOutlineRow(page))?.inView).toBe(false);
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
