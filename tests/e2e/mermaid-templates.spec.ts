/**
 * Mermaid templates (spec §5 M17b, design pass §9): Insert ▾ → Diagram ▸
 * is one standard submenu row listing the five templates with icons. The
 * last used one is marked and focused first; the submenu flips beside the
 * menu instead of covering its rows; when no template can go here, one
 * note at the top says why. The palette lists them as "Insert diagram:
 * …", and E's template action is no row of its own in the Insert menu.
 */
import { expect, type Page, test } from "@playwright/test";

import {
  expectNoSeriousA11yViolations,
  openToolbarTestDoc,
} from "./helpers/a11y";

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
  page.getByRole("menuitem", { name: "Diagram", exact: true });

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
    await expect(templatesItem(page)).toHaveAttribute("aria-haspopup", "menu");
    await expect(page.getByRole("menuitem", { name: /^Diagram/ })).toHaveCount(
      1,
    );
    // No separate "▸" tile beside the row.
    await expect(
      page.getByRole("menuitem", { name: "Pick a diagram template" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("menuitem", { name: "Insert diagram" }),
    ).toHaveCount(0);
    // A fresh profile has used no template: nothing is marked Last used.
    await templatesItem(page).hover();
    await expect(
      page.getByRole("menuitem", { name: "Flowchart", exact: true }),
    ).not.toHaveAccessibleDescription("Last used");
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

  test("Enter on Diagram opens the submenu, with an icon per template", async ({
    page,
  }) => {
    await openDoc(page);
    await openInsertMenu(page);
    // Until the insert step's chunk lands, Diagram is one item that
    // inserts; wait for the submenu trigger it brings.
    await expect(templatesItem(page)).toHaveAttribute("aria-haspopup", "menu");
    await templatesItem(page).focus();
    await page.keyboard.press("Enter");
    const flowchart = page.getByRole("menuitem", {
      name: "Flowchart",
      exact: true,
    });
    await expect(flowchart).toBeVisible();
    for (const [label] of TEMPLATES) {
      await expect(
        page.getByRole("menuitem", { name: label, exact: true }).locator("svg"),
      ).toHaveCount(1);
    }
    expect(await mermaidSources(page)).toEqual([]);
  });

  test("at 1024 the submenu flips beside the menu, never over its rows", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await openDoc(page);
    await openInsertMenu(page);
    await templatesItem(page).hover();
    const sub = page.locator('[data-slot="dropdown-menu-sub-content"]');
    await expect(sub).toBeVisible();
    await sub.evaluate((el) =>
      Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
    );
    const child = await sub.boundingBox();
    const row = await templatesItem(page).boundingBox();
    if (!child || !row) throw new Error("menu not laid out");
    // Side by side: it may cover the menu's 4px padding, never its rows.
    const overlap =
      Math.min(row.x + row.width, child.x + child.width) -
      Math.max(row.x, child.x);
    expect(overlap).toBeLessThanOrEqual(1);
    // Anchored to its row.
    expect(child.y).toBeLessThanOrEqual(row.y + row.height);
    expect(child.y + child.height).toBeGreaterThanOrEqual(row.y);
  });

  test("in the title, one note replaces the per-row reasons", async ({
    page,
  }) => {
    await openDoc(page);
    await page.evaluate(() =>
      window.__tiptap_editor?.chain().focus().setTextSelection(1).run(),
    );
    await openInsertMenu(page);
    // Other rows show their reason as a visible second line (§10).
    const table = page.getByRole("menuitem", { name: /^Table/ });
    const reason = table.locator('[data-slot="dropdown-menu-reason"]');
    await expect(reason).toBeVisible();
    await expect(reason).toHaveText(/^Not available/);
    await expect(table).toHaveAccessibleDescription(
      (await reason.textContent()) ?? "",
    );
    // Only the label (and icon) dims: the item and its reason stay at full
    // opacity.
    expect(await table.evaluate((el) => getComputedStyle(el).opacity)).toBe(
      "1",
    );
    expect(await reason.evaluate((el) => getComputedStyle(el).opacity)).toBe(
      "1",
    );
    const label = table.getByText("Table", { exact: true });
    expect(await label.evaluate((el) => getComputedStyle(el).opacity)).toBe(
      "0.5",
    );
    expect(
      await table
        .locator("svg")
        .first()
        .evaluate((el) => getComputedStyle(el).opacity),
    ).toBe("0.5");
    await templatesItem(page).hover();
    const note = page.locator("[data-diagram-note]");
    await expect(note).toHaveText(
      "Can’t insert in the title. Move the cursor to a paragraph.",
    );
    const items = page.locator("[data-template]");
    await expect(items).toHaveCount(TEMPLATES.length);
    for (const item of await items.all()) {
      await expect(item).toHaveAttribute("aria-disabled", "true");
      await expect(item).toHaveAccessibleDescription(
        "Can’t insert in the title. Move the cursor to a paragraph.",
      );
    }
    await expectNoSeriousA11yViolations(page, [
      '[data-slot="dropdown-menu-sub-content"]',
    ]);
  });

  test("inside a diagram, the note names the diagram", async ({ page }) => {
    await openDoc(page);
    await openInsertMenu(page);
    await templatesItem(page).hover();
    await page
      .getByRole("menuitem", { name: "Pie chart", exact: true })
      .click();
    await expect.poll(async () => (await mermaidSources(page)).length).toBe(1);
    await page.evaluate(() => {
      const editor = window.__tiptap_editor;
      if (!editor) throw new Error("editor missing");
      let inside = -1;
      editor.state.doc.descendants((node, pos) => {
        const mermaid =
          /mermaid/i.test(node.type.name) || node.attrs.language === "mermaid";
        if (inside < 0 && mermaid) inside = pos + 1;
        return inside < 0;
      });
      editor.chain().focus().setTextSelection(inside).run();
    });
    await openInsertMenu(page);
    await templatesItem(page).hover();
    await expect(page.locator("[data-diagram-note]")).toHaveText(
      "Can’t insert inside a diagram. Move the cursor to a paragraph.",
    );
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
