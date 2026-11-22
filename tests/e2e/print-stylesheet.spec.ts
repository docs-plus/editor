import { mkdirSync } from "node:fs";
import path from "node:path";

import { expect, type Page, test } from "@playwright/test";

import { EditorPage } from "./helpers/editor-page";

/**
 * Print and Save as PDF (details spec E6, P2.12): the print stylesheet
 * hides the chrome, prints folded sections open and lets the document run
 * across pages. `PRINT_SCREENSHOTS=<dir>` also saves the print previews
 * for the design review.
 */
const text = (value: string) => [{ type: "text", text: value }];

const PRINT_DOC = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: text("Quarterly notes") },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Printing keeps " },
        { type: "text", text: "bold", marks: [{ type: "bold" }] },
        {
          type: "text",
          text: ", links and lists, and drops the app around them.",
        },
      ],
    },
    { type: "heading", attrs: { level: 2 }, content: text("Folded section") },
    { type: "paragraph", content: text("This text is folded on screen.") },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [{ type: "paragraph", content: text("first") }],
        },
        {
          type: "listItem",
          content: [{ type: "paragraph", content: text("second") }],
        },
      ],
    },
    { type: "heading", attrs: { level: 2 }, content: text("Open section") },
    { type: "paragraph", content: text("Last paragraph.") },
  ],
};

async function foldSection(page: Page, title: string): Promise<void> {
  await page.evaluate((heading: string) => {
    const editor = window.__tiptap_editor;
    let id: string | null = null;
    editor?.state.doc.forEach((node) => {
      if (node.textContent === heading) id = node.attrs["data-toc-id"];
    });
    if (!id) throw new Error(`no id for ${heading}`);
    editor?.commands.toggleFold(id);
  }, title);
  await expect(page.locator(".tiptap h2", { hasText: title })).toHaveClass(
    /heading-section-folded/,
  );
}

async function savePreview(page: Page, name: string): Promise<void> {
  const dir = process.env.PRINT_SCREENSHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name), fullPage: true });
}

test.describe("print stylesheet", () => {
  test.beforeEach(async ({ page }) => {
    const editorPage = new EditorPage(page);
    await editorPage.goto();
    await editorPage.waitForSync();
    await editorPage.setContent(PRINT_DOC);
    await page.locator(".toc-sidebar").waitFor({ state: "visible" });
    await foldSection(page, "Folded section");
  });

  test("screen shows the chrome and hides the folded text", async ({
    page,
  }) => {
    await expect(page.locator('[role="toolbar"]').first()).toBeVisible();
    await expect(page.getByText("This text is folded on screen.")).toBeHidden();
    await savePreview(page, "screen-light.png");
  });

  test("print hides the chrome and prints folded sections open", async ({
    page,
  }) => {
    await page.emulateMedia({ media: "print" });

    // Chrome: tabs, toolbar, outline, status chips.
    await expect(page.locator("[data-tab-id]").first()).toBeHidden();
    await expect(page.locator('[role="toolbar"]').first()).toBeHidden();
    await expect(page.locator(".toc-sidebar")).toBeHidden();
    await expect(page.locator(".heading-fold-crinkle")).toBeHidden();

    // The document: every section, the folded one open.
    await expect(page.locator(".tiptap")).toBeVisible();
    await expect(
      page.getByText("This text is folded on screen."),
    ).toBeVisible();
    await expect(page.getByText("second")).toBeVisible();
    await expect(page.getByText("Last paragraph.")).toBeVisible();

    // Nothing clips the document to one screen, and headings stay with
    // the text after them.
    const layout = await page.evaluate(() => {
      const wrapper = document.querySelector(".document-editor-wrapper");
      const heading = document.querySelector(".tiptap h2");
      return {
        overflow: wrapper ? getComputedStyle(wrapper).overflowY : null,
        breakAfter: heading ? getComputedStyle(heading).breakAfter : null,
      };
    });
    expect(layout.overflow).toBe("visible");
    expect(layout.breakAfter).toBe("avoid");

    await savePreview(page, "print-light.png");
  });

  test("print is light in the dark theme", async ({ page }) => {
    await page.emulateMedia({ media: "print" });
    const textColor = (dark: boolean) =>
      page.evaluate((on: boolean) => {
        document.documentElement.classList.toggle("dark", on);
        const paragraph = document.querySelector(".tiptap p");
        return paragraph ? getComputedStyle(paragraph).color : "";
      }, dark);
    const light = await textColor(false);
    // Dark text on paper whatever the theme: the light print's colour.
    expect(await textColor(true)).toBe(light);
    await savePreview(page, "print-dark-theme.png");
  });
});
