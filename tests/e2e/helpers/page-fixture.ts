import type { Page } from "@playwright/test";
import type { JSONContent } from "@tiptap/core";

import { EditorPage } from "./editor-page";

/**
 * A document that touches every block the page engine styles: the title,
 * runs of paragraphs (one long enough to wrap), lists with second
 * paragraphs and nesting, a task list, a table with a header row, a
 * blockquote, a code block, inline code, a link and all six heading levels
 * inside one H1 section (so HeadingScale draws six ranks), then a second
 * H1 section. Valid against `heading block*`.
 */

const text = (value: string, marks?: JSONContent["marks"]): JSONContent =>
  marks ? { type: "text", text: value, marks } : { type: "text", text: value };

const paragraph = (...content: JSONContent[]): JSONContent => ({
  type: "paragraph",
  content,
});

const heading = (level: number, ...content: JSONContent[]): JSONContent => ({
  type: "heading",
  attrs: { level },
  content,
});

const listItem = (...content: JSONContent[]): JSONContent => ({
  type: "listItem",
  content,
});

const taskItem = (checked: boolean, value: string): JSONContent => ({
  type: "taskItem",
  attrs: { checked },
  content: [paragraph(text(value))],
});

const cell = (
  type: "tableHeader" | "tableCell",
  ...content: JSONContent[]
): JSONContent => ({ type, content });

const LONG_PARAGRAPH =
  "This paragraph is deliberately long so that it wraps across several lines at every viewport we test, which makes line height, letter spacing and the width of the page card visible in the screenshot: if any of them moves by a fraction of a pixel, every following block moves with it and the comparison fails loudly instead of quietly.";

export const PAGE_FIXTURE: JSONContent = {
  type: "doc",
  content: [
    heading(1, text("Page engine fixture")),
    paragraph(text("The first paragraph sits right under the title.")),
    paragraph(text("A second short paragraph follows it directly.")),
    paragraph(text(LONG_PARAGRAPH)),
    paragraph(
      text("Inline code such as "),
      text("const answer = 42", [{ type: "inlineCode" }]),
      text(" sits in running text next to "),
      text("a link to docs.plus", [
        { type: "hyperlink", attrs: { href: "https://docs.plus" } },
      ]),
      text("."),
    ),
    heading(2, text("Lists")),
    {
      type: "bulletList",
      content: [
        listItem(paragraph(text("First bullet item"))),
        listItem(
          paragraph(text("Second bullet item with a second paragraph")),
          paragraph(text("The second paragraph of the second bullet.")),
        ),
        listItem(paragraph(text("Third bullet item with a nested list")), {
          type: "bulletList",
          content: [
            listItem(paragraph(text("Nested bullet one"))),
            listItem(paragraph(text("Nested bullet two"))),
          ],
        }),
      ],
    },
    {
      type: "orderedList",
      attrs: { start: 1 },
      content: [
        listItem(paragraph(text("First numbered item"))),
        listItem(
          paragraph(text("Second numbered item with a second paragraph")),
          paragraph(text("The second paragraph of the numbered item.")),
        ),
        listItem(paragraph(text("Third numbered item with a nested list")), {
          type: "orderedList",
          attrs: { start: 1 },
          content: [
            listItem(paragraph(text("Nested number one"))),
            listItem(paragraph(text("Nested number two"))),
          ],
        }),
      ],
    },
    heading(3, text("Tasks")),
    {
      type: "taskList",
      content: [
        taskItem(true, "A finished task"),
        taskItem(false, "An open task"),
        taskItem(false, "Another open task"),
      ],
    },
    heading(4, text("A table")),
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            cell("tableHeader", paragraph(text("Name"))),
            cell("tableHeader", paragraph(text("Role"))),
            cell("tableHeader", paragraph(text("Notes"))),
          ],
        },
        {
          type: "tableRow",
          content: [
            cell("tableCell", paragraph(text("Ada"))),
            cell("tableCell", paragraph(text("Engineer"))),
            cell(
              "tableCell",
              paragraph(text("First paragraph in a cell.")),
              paragraph(text("Second paragraph in the same cell.")),
            ),
          ],
        },
        {
          type: "tableRow",
          content: [
            cell("tableCell", paragraph(text("Grace"))),
            cell("tableCell", paragraph(text("Admiral"))),
            cell("tableCell", paragraph(text("One line."))),
          ],
        },
      ],
    },
    heading(5, text("A quote")),
    {
      type: "blockquote",
      content: [
        paragraph(text("The first paragraph of the quote.")),
        paragraph(text("The second paragraph of the quote.")),
      ],
    },
    heading(
      6,
      text("Code with "),
      text("inlineCode", [{ type: "inlineCode" }]),
      text(" in a heading"),
    ),
    {
      type: "codeBlock",
      attrs: { language: "typescript" },
      content: [
        text(
          'function greet(name: string): string {\n  return "Hello, " + name + "!";\n}\n\nconsole.log(greet("page"));',
        ),
      ],
    },
    paragraph(text("A closing paragraph for the first section.")),
    heading(1, text("Second section")),
    paragraph(text("The second H1 section starts a new scale.")),
    heading(2, text("A subsection")),
    paragraph(text("The last paragraph of the document.")),
  ],
};

export type PixelTheme = "light" | "dark";

/** Local-only keys every TinyDocy before the page engine could have written. */
const LEGACY_CHOICES = JSON.stringify({ v: 1, slots: {} });
const FIXED_USER = JSON.stringify({ name: "Ada Lovelace", color: "#64B5F6" });

/**
 * Freezes everything that moves without the document changing: the caret
 * and collaborator carets, animations and transitions, scroll smoothing,
 * and the Next.js dev overlay.
 */
const FREEZE_CSS = `
*, *::before, *::after {
  animation: none !important;
  transition: none !important;
  caret-color: transparent !important;
  scroll-behavior: auto !important;
}
.collaboration-carets__caret,
.collaboration-carets__label,
nextjs-portal {
  display: none !important;
}
`;

/**
 * Opens a fresh isolated document at `baseURL` as a returning visitor
 * (theme stored, legacy keys present), loads `PAGE_FIXTURE` and waits for
 * a still frame. `baseURL` may differ from the test's own baseURL (the
 * classic pixel spec loads main and the branch in turn).
 */
export async function preparePixelPage(
  page: Page,
  baseURL: string,
  opts: { theme: PixelTheme; hocusUrl?: string },
): Promise<void> {
  await page.addInitScript(
    ({ theme, choices, user, hocusUrl, css }) => {
      localStorage.setItem("tinydocy-theme", theme);
      localStorage.setItem("tinydocy-choices", choices);
      localStorage.setItem("tinydocy-user", user);
      if (hocusUrl) {
        (window as Window & { __HOCUS_URL?: string }).__HOCUS_URL = hocusUrl;
      }
      // Frozen from the first paint: a transition that runs during boot
      // (the pressed outline toggle, the toolbar) can leave a partly
      // re-rastered edge that differs by a few anti-aliased pixels.
      const freeze = () => {
        if (document.getElementById("pixel-freeze")) return;
        const style = document.createElement("style");
        style.id = "pixel-freeze";
        style.textContent = css;
        document.head.append(style);
      };
      if (document.head) freeze();
      else document.addEventListener("DOMContentLoaded", freeze);
    },
    {
      theme: opts.theme,
      choices: LEGACY_CHOICES,
      user: FIXED_USER,
      hocusUrl: opts.hocusUrl ?? null,
      css: FREEZE_CSS,
    },
  );

  await openIsolatedDocument(page, baseURL);
  await new EditorPage(page).waitForSync();
  await page.evaluate((content) => {
    window.__tiptap_editor?.commands.setContent(content);
  }, PAGE_FIXTURE);
  await freezePage(page);
}

/**
 * `EditorPage.goto` against an absolute `baseURL`: a fresh document in its
 * own `global-tabs-*` doc, with the tab list seeded before boot.
 */
async function openIsolatedDocument(
  page: Page,
  baseURL: string,
): Promise<void> {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const id = `pixel-${nonce}`;
  const tabsState = {
    tabs: [
      { id: "playground", title: "Playground", createdAt: 0 },
      { id, title: "Untitled", createdAt: Date.now() },
    ],
    activeTabId: id,
  };
  await page.addInitScript(
    ({ tabsDoc, state }) => {
      (window as Window & { __GLOBAL_TABS_DOC?: string }).__GLOBAL_TABS_DOC =
        tabsDoc;
      localStorage.setItem("tinydocy-tabs", JSON.stringify(state));
    },
    { tabsDoc: `global-tabs-${id}`, state: tabsState },
  );
  await page.goto(new URL("/", baseURL).toString());
  await page.waitForSelector(`[data-tab-id="${id}"]`, { timeout: 15_000 });
  await page.waitForSelector(".tiptap", { state: "visible", timeout: 15_000 });
}

/**
 * Blurs the editor, freezes motion, waits for fonts and repaints the page
 * in full.
 */
export async function freezePage(page: Page): Promise<void> {
  await page.evaluate((css) => {
    window.__tiptap_editor?.commands.blur();
    (document.activeElement as HTMLElement | null)?.blur();
    window.getSelection()?.removeAllRanges();
    if (!document.getElementById("pixel-freeze")) {
      const style = document.createElement("style");
      style.id = "pixel-freeze";
      style.textContent = css;
      document.head.append(style);
    }
  }, FREEZE_CSS);
  await page.mouse.move(0, 0);
  await page.evaluate(async () => {
    const frames = () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
    await document.fonts.ready;
    // Hide and show the page so every layer is painted again in full:
    // partial re-raster after a state change can leave edge pixels that a
    // fresh paint draws differently. Visibility keeps layout and scroll.
    const root = document.documentElement;
    root.style.visibility = "hidden";
    await frames();
    root.style.visibility = "";
    await frames();
  });
}
