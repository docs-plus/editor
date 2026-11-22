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
const IMAGE_SVG = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="#888"/></svg>',
);

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
    // Blocks whose own display is not `block` (table wrapper, media and
    // diagram node views) must print as they show on screen.
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: ["Folded cell", "Other cell"].map((cell) => ({
            type: "tableCell",
            content: [{ type: "paragraph", content: text(cell) }],
          })),
        },
      ],
    },
    {
      type: "image",
      attrs: { src: `data:image/svg+xml,${IMAGE_SVG}`, alt: "Folded image" },
    },
    // A caption gives the media kit's inner figure an inline
    // `display:table`; the block the fold hides stays `block`.
    {
      type: "image",
      attrs: {
        src: `data:image/svg+xml,${IMAGE_SVG}`,
        alt: "Captioned image",
        caption: "A captioned figure",
      },
    },
    {
      type: "codeBlock",
      attrs: { language: "mermaid" },
      content: text("graph TD; A-->B"),
    },
    { type: "heading", attrs: { level: 2 }, content: text("Open section") },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Inline " },
        { type: "text", text: "code", marks: [{ type: "inlineCode" }] },
        { type: "text", text: " and a " },
        {
          type: "text",
          text: "highlight",
          marks: [{ type: "highlight", attrs: { color: "yellow" } }],
        },
        { type: "text", text: "." },
      ],
    },
    {
      type: "blockquote",
      content: [{ type: "paragraph", content: text("A quoted line.") }],
    },
    {
      type: "codeBlock",
      attrs: { language: "javascript" },
      content: text("const total = items.reduce((sum, x) => sum + x, 0);"),
    },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: ["Quarter", "Revenue"].map((cell) => ({
            type: "tableHeader",
            content: [{ type: "paragraph", content: text(cell) }],
          })),
        },
        {
          type: "tableRow",
          content: ["Q3", "1,200"].map((cell) => ({
            type: "tableCell",
            content: [{ type: "paragraph", content: text(cell) }],
          })),
        },
      ],
    },
    { type: "paragraph", content: text("Last paragraph.") },
  ],
};

/** Toggles the section `title` starts, then waits for it to be `folded`. */
async function foldSection(
  page: Page,
  title: string,
  folded = true,
): Promise<void> {
  await page.evaluate((heading: string) => {
    const editor = window.__tiptap_editor;
    let id: string | null = null;
    editor?.state.doc.forEach((node) => {
      if (node.textContent === heading) id = node.attrs["data-toc-id"];
    });
    if (!id) throw new Error(`no id for ${heading}`);
    editor?.commands.toggleFold(id);
  }, title);
  const heading = page.locator(".tiptap h2", { hasText: title });
  if (folded) await expect(heading).toHaveClass(/heading-section-folded/);
  // Unfolding animates; a toggle before it ends is not a fold.
  else
    await expect(heading).not.toHaveClass(/heading-section-(folded|unfolding)/);
}

/**
 * Computed `display` of each top-level block in the section `title`
 * starts, up to the next heading, by node type.
 */
async function sectionDisplays(
  page: Page,
  title: string,
): Promise<[string, string][]> {
  return page.evaluate((heading: string) => {
    const editor = window.__tiptap_editor;
    if (!editor) throw new Error("no editor");
    const out: [string, string][] = [];
    let inside = false;
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === "heading") {
        inside = node.textContent === heading;
        return;
      }
      if (!inside) return;
      const dom = editor.view.nodeDOM(offset);
      if (!(dom instanceof HTMLElement)) throw new Error("no block DOM");
      out.push([node.type.name, getComputedStyle(dom).display]);
    });
    return out;
  }, title);
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

  test("a folded block prints with the display it has on screen", async ({
    page,
  }) => {
    // Unfold to read each block's own display on screen, fold again, print.
    const folded = await sectionDisplays(page, "Folded section");
    expect(folded.map(([, display]) => display)).toEqual(
      folded.map(() => "none"),
    );
    await foldSection(page, "Folded section", false);
    const screen = await sectionDisplays(page, "Folded section");
    expect(screen.map(([type]) => type)).toEqual([
      "paragraph",
      "bulletList",
      "table",
      "image",
      "image",
      "codeBlock",
    ]);
    await foldSection(page, "Folded section");

    await page.emulateMedia({ media: "print" });
    expect(await sectionDisplays(page, "Folded section")).toEqual(screen);
    await expect(page.getByText("Folded cell")).toBeVisible();
    await expect(page.getByRole("img", { name: "Folded image" })).toBeVisible();
    await expect(page.getByText("A captioned figure")).toBeVisible();
  });

  test("print is light in the dark theme", async ({ page }) => {
    await page.emulateMedia({ media: "print" });
    // Ink of body text, inline code and a code block, as printed.
    const ink = () =>
      page.evaluate(() =>
        [".tiptap p", ".tiptap p code", ".tiptap pre"].map((selector) => {
          const element = [...document.querySelectorAll(selector)].at(-1);
          return element ? getComputedStyle(element).color : "";
        }),
      );
    const light = await ink();

    await page.evaluate(() => document.documentElement.classList.add("dark"));
    // Not vacuous: without the swap, the dark theme's ink is different.
    const dark = await ink();
    for (const [index, color] of dark.entries()) {
      expect(color).not.toBe(light[index]);
    }
    // `emulateMedia` fires no print events; the print dialog does.
    await page.evaluate(() => window.dispatchEvent(new Event("beforeprint")));
    expect(await ink()).toEqual(light);
    await savePreview(page, "print-dark-theme.png");

    await page.evaluate(() => window.dispatchEvent(new Event("afterprint")));
    expect(
      await page.evaluate(() =>
        document.documentElement.classList.contains("dark"),
      ),
    ).toBe(true);
  });
});

test("print leaves pages without the editor whole", async ({ page }) => {
  await page.goto("/privacy");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("h1").first()).toBeVisible();
});
