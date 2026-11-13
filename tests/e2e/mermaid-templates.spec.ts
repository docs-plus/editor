/**
 * Mermaid templates (spec §5 M17b): Insert ▾ → Diagram ▸ lists the five
 * templates, marks the last used one and focuses it first; the palette
 * lists them as "Insert diagram: …". Diagram itself still inserts, and
 * E's template action is no row of its own in the Insert menu.
 */
import { expect, type Page, test } from "@playwright/test";

import { openToolbarTestDoc } from "./helpers/a11y";

const TEMPLATES = [
  ["Flowchart", "flowchart LR"],
  ["Sequence", "sequenceDiagram"],
  ["State", "stateDiagram-v2"],
  ["Mind map", "mindmap"],
  ["Pie chart", "pie title"],
] as const;

const row = (page: Page) =>
  page.getByRole("toolbar", { name: "Formatting", exact: true });
const menu = (page: Page) => page.getByRole("menu").first();
const templatesItem = (page: Page) =>
  page.getByRole("menuitem", { name: "Pick a diagram template" });

/** A fresh empty paragraph at the end, with the caret in it. */
async function caretInNewParagraph(page: Page) {
  await page.evaluate(() => {
    const editor = window.__tiptap_editor;
    if (!editor) throw new Error("editor missing");
    const end = editor.state.doc.content.size;
    editor
      .chain()
      .focus()
      .insertContentAt(end, { type: "paragraph" })
      .setTextSelection(end + 1)
      .run();
  });
}

async function openInsertMenu(page: Page) {
  await row(page).getByRole("button", { name: "Insert", exact: true }).click();
  await expect(menu(page)).toBeVisible();
}

/** The Mermaid sources in the document, in order. */
const mermaidSources = (page: Page) =>
  page.evaluate(() => {
    const sources: string[] = [];
    window.__tiptap_editor?.state.doc.descendants((node) => {
      const mermaid =
        /mermaid/i.test(node.type.name) || node.attrs.language === "mermaid";
      if (mermaid) sources.push(node.textContent);
      return true;
    });
    return sources;
  });

async function openDoc(page: Page) {
  await openToolbarTestDoc(page);
  // E's engine lists the templates; it loads right after the editor.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.querySelector("[data-server-synced]") !== null &&
          window.__tiptap_editor !== undefined,
      ),
    )
    .toBe(true);
  await caretInNewParagraph(page);
}

test.describe("Mermaid templates (M17b)", () => {
  test("the Insert menu has one Diagram row and no stray template row", async ({
    page,
  }) => {
    await openDoc(page);
    await openInsertMenu(page);
    await expect(templatesItem(page)).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /^Diagram/ })).toHaveCount(
      1,
    );
    await expect(
      page.getByRole("menuitem", { name: "Insert diagram" }),
    ).toHaveCount(0);
  });

  for (const [label, keyword] of TEMPLATES) {
    test(`Insert ▾ → Diagram ▸ → ${label} inserts a rendered diagram`, async ({
      page,
    }) => {
      await openDoc(page);
      await openInsertMenu(page);
      await templatesItem(page).hover();
      await page.getByRole("menuitem", { name: label, exact: true }).click();
      await expect
        .poll(() => mermaidSources(page))
        .toEqual([expect.stringContaining(keyword)]);
      const preview = page.locator(".mermaid-diagram__preview").last();
      await expect(preview.locator("svg").first()).toBeVisible({
        timeout: 10_000,
      });
    });
  }

  test("the last used template is described and focused first", async ({
    page,
  }) => {
    await openDoc(page);
    await openInsertMenu(page);
    await templatesItem(page).hover();
    await page.getByRole("menuitem", { name: "Sequence", exact: true }).click();
    await expect
      .poll(() => mermaidSources(page))
      .toEqual([expect.stringContaining("sequenceDiagram")]);

    await caretInNewParagraph(page);
    await openInsertMenu(page);
    await templatesItem(page).focus();
    await page.keyboard.press("ArrowRight");
    const sequence = page.getByRole("menuitem", {
      name: "Sequence",
      exact: true,
    });
    await expect(sequence).toBeFocused();
    await expect(sequence).toHaveAccessibleDescription("Last used");
    await expect(
      page.getByRole("menuitem", { name: "Flowchart", exact: true }),
    ).not.toHaveAccessibleDescription("Last used");
  });

  test("Diagram itself still inserts with one click", async ({ page }) => {
    await openDoc(page);
    await openInsertMenu(page);
    await page.getByRole("menuitem", { name: /^Diagram/ }).click();
    await expect.poll(async () => (await mermaidSources(page)).length).toBe(1);
  });

  test("the palette inserts a template: Insert diagram: Pie chart", async ({
    page,
  }) => {
    await openDoc(page);
    await page.keyboard.press("Alt+Slash");
    await page.keyboard.type("pie chart");
    await page
      .getByRole("option", { name: /^Insert diagram: Pie chart/ })
      .click();
    await expect
      .poll(() => mermaidSources(page))
      .toEqual([expect.stringContaining("pie title")]);
  });
});
