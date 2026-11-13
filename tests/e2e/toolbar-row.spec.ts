import { mkdirSync } from "node:fs";
import path from "node:path";

import { type BrowserContext, expect, type Page, test } from "@playwright/test";

import { TOOLBAR_SETTLE_MS } from "@/hooks/use-tiptap-editor";
import { generateLargeDocument } from "@/tests/helpers/document-generators";
import { writeReport } from "@/tests/helpers/report-writer";

import { setTheme } from "./helpers/a11y";
import { EditorPage } from "./helpers/editor-page";

const toolbar = (page: Page) => page.getByRole("toolbar");
const toolbarButton = (page: Page, name: string) =>
  toolbar(page).getByRole("button", { name, exact: true });

const text = (value: string, marks?: unknown[]) => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const heading = (level: number, value: string) => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});
const paragraph = (...content: unknown[]) => ({ type: "paragraph", content });

const DOC = {
  type: "doc",
  content: [
    heading(1, "Title"),
    paragraph(text("Plain paragraph")),
    heading(2, "Alpha"),
    paragraph(text("Alpha body")),
    heading(2, "Beta"),
    paragraph(text("Beta body")),
    {
      type: "codeBlock",
      attrs: { language: "typescript" },
      content: [text("const a = 1;")],
    },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [paragraph(text("Cell A"))] },
            { type: "tableCell", content: [paragraph(text("Cell B"))] },
          ],
        },
      ],
    },
    paragraph(
      text("Styled", [
        { type: "bold" },
        { type: "italic" },
        { type: "hyperlink", attrs: { href: "https://example.com" } },
      ]),
      text(" tail"),
    ),
  ],
};

async function openDoc(page: Page, docId?: string): Promise<EditorPage> {
  const editorPage = new EditorPage(page);
  await editorPage.goto(docId);
  await editorPage.waitForSync();
  await editorPage.setContent(DOC);
  return editorPage;
}

/** Puts the caret at the end of the first block whose text starts with `needle`. */
async function caretIn(page: Page, needle: string): Promise<void> {
  await page.evaluate((target) => {
    const editor = window.__tiptap_editor;
    if (!editor) throw new Error("editor missing");
    let pos = -1;
    editor.state.doc.descendants((node, p) => {
      if (pos >= 0) return false;
      if (node.isTextblock && node.textContent.startsWith(target)) {
        pos = p + 1 + node.content.size;
      }
      return true;
    });
    editor.chain().setTextSelection(pos).focus().run();
  }, needle);
  // Tiptap's focus() applies itself a frame later; keys sent before it
  // would go elsewhere or be undone by it.
  await expect(page.locator(".tiptap")).toBeFocused();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
}

/** Accessible names of the roving items outside the context slot. */
async function rowNames(page: Page): Promise<string[]> {
  return toolbar(page).evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>("[data-toolbar-item]"))
      .filter((el) => !el.closest('[data-slot="context-slot"]'))
      .map(
        (el) => el.getAttribute("aria-label") ?? el.textContent?.trim() ?? "?",
      ),
  );
}

const slot = (page: Page) => page.locator('[data-slot="context-slot"]');

test.describe("sorted row", () => {
  test("keeps the same order in a paragraph, a heading and a code block", async ({
    page,
  }) => {
    await openDoc(page);
    await caretIn(page, "Plain");
    const inParagraph = await rowNames(page);
    await caretIn(page, "Alpha");
    await expect(slot(page)).toHaveAttribute("aria-label", "Section tools");
    const inHeading = await rowNames(page);
    await caretIn(page, "const");
    await expect(slot(page)).toHaveAttribute("aria-label", "Code block tools");
    const inCode = await rowNames(page);
    // Names of value menus change with the value; positions never do.
    const shape = (names: string[]) =>
      names.map((name) =>
        /^(Normal text|Heading \d|Title|Mixed|Align .*|Justify)$/.test(name)
          ? "<value>"
          : name,
      );
    expect(shape(inHeading)).toEqual(shape(inParagraph));
    expect(shape(inCode)).toEqual(shape(inParagraph));
    const order = [
      "Undo",
      "Redo",
      "<value>",
      "Bold",
      "Italic",
      "Underline",
      "Strike",
    ];
    const start = shape(inParagraph).indexOf("Undo");
    expect(shape(inParagraph).slice(start, start + order.length)).toEqual(
      order,
    );
    const names = shape(inParagraph);
    expect(names.indexOf("Link")).toBeLessThan(names.indexOf("Outdent"));
    expect(names.indexOf("Outdent")).toBeLessThan(names.indexOf("Indent"));
    expect(names.indexOf("Indent")).toBeLessThan(
      names.indexOf("More formatting"),
    );
  });

  test("advertises bound shortcuts with aria-keyshortcuts (#612)", async ({
    page,
  }) => {
    await openDoc(page);
    await caretIn(page, "Plain");
    await expect(toolbarButton(page, "Bold")).toHaveAttribute(
      "aria-keyshortcuts",
      /^(Meta|Control)\+B$/,
    );
    await expect(toolbarButton(page, "Undo")).not.toHaveAttribute(
      "aria-pressed",
      /.*/,
    );
  });
});

test.describe("keyboard model", () => {
  test("the toolbar is one Tab stop", async ({ page }) => {
    await openDoc(page);
    await caretIn(page, "Plain");
    await page.keyboard.press("Alt+F10");
    const first = await page.evaluate(() =>
      document.activeElement?.getAttribute("aria-label"),
    );
    expect(
      await toolbar(page).evaluate((el) => el.contains(document.activeElement)),
    ).toBe(true);
    await page.keyboard.press("ArrowRight");
    const second = await page.evaluate(() =>
      document.activeElement?.getAttribute("aria-label"),
    );
    expect(second).not.toBe(first);
    const tabbable = await toolbar(page).evaluate(
      (el) => el.querySelectorAll('[data-toolbar-item][tabindex="0"]').length,
    );
    expect(tabbable).toBe(1);
    await page.keyboard.press("Tab");
    expect(
      await toolbar(page).evaluate((el) => el.contains(document.activeElement)),
    ).toBe(false);
    await page.keyboard.press("Shift+Tab");
    expect(
      await page.evaluate(() =>
        document.activeElement?.getAttribute("aria-label"),
      ),
    ).toBe(second);
  });

  test("Alt+F10 moves to the toolbar and Esc returns with the selection", async ({
    page,
  }) => {
    await openDoc(page);
    await page.locator(".tiptap p", { hasText: "Plain paragraph" }).click();
    await page.keyboard.press("End");
    for (let i = 0; i < 9; i++) await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Alt+F10");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");
    await expect(page.locator(".tiptap")).toBeFocused();
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
      "paragraph",
    );
  });
});

test.describe("context slot", () => {
  test("follows the selection and hides from AT when empty", async ({
    page,
  }) => {
    await openDoc(page);
    await caretIn(page, "Plain");
    await expect(slot(page)).toHaveAttribute("aria-hidden", "true");
    await caretIn(page, "Title");
    await expect(slot(page)).toHaveAttribute("aria-label", "Title");
    await caretIn(page, "Alpha");
    const group = page.getByRole("group", { name: "Section tools" });
    await expect(group.getByRole("button")).toHaveCount(3);
    await expect(
      group.getByRole("button", { name: "Move section up" }),
    ).toHaveAttribute("aria-disabled", "true");
    await caretIn(page, "Cell A");
    const table = page.getByRole("group", { name: "Table tools" });
    await expect(
      table.getByRole("button", { name: "Row", exact: true }),
    ).toBeVisible();
    await expect(
      table.getByRole("button", { name: "Header row" }),
    ).toBeVisible();
    await caretIn(page, "const");
    const code = page.getByRole("group", { name: "Code block tools" });
    await expect(
      code.getByRole("button", { name: "TypeScript" }),
    ).toHaveAttribute("aria-haspopup", "menu");
  });

  test("Move section up moves the section and keeps focus on the button", async ({
    page,
  }) => {
    await openDoc(page);
    await caretIn(page, "Beta");
    const up = slot(page).getByRole("button", { name: "Move section up" });
    await up.focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".tiptap h2").first()).toHaveText("Beta");
    await expect(up).toBeFocused();
  });

  test("Fold section folds the heading at the caret", async ({ page }) => {
    const editorPage = await openDoc(page);
    await caretIn(page, "Alpha");
    const tocId = await page.evaluate(() => {
      let id: string | null = null;
      window.__tiptap_editor?.state.doc.forEach((node) => {
        if (node.textContent === "Alpha") id = node.attrs["data-toc-id"];
      });
      return id;
    });
    expect(tocId).toBeTruthy();
    await slot(page).getByRole("button", { name: "Fold section" }).click();
    await expect
      .poll(() => editorPage.isSectionFolded(tocId as unknown as string))
      .toBe(true);
  });

  test("remote heading deletion while the slot is focused", async ({
    browser,
  }) => {
    const docId = `slot-remote-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const contexts: BrowserContext[] = [];
    const openUser = async (name: string) => {
      const ctx = await browser.newContext();
      contexts.push(ctx);
      const page = await ctx.newPage();
      await page.addInitScript(
        `window.__HOCUS_TOKEN = ${JSON.stringify(`${name}-${docId}`)}`,
      );
      const editorPage = new EditorPage(page);
      await editorPage.goto(docId);
      await editorPage.waitForSync();
      return page;
    };
    try {
      const a = await openUser("slot-a");
      // After "Beta" goes, B's caret maps into a heading that could move
      // up, so only the held heading id stops a move of the wrong section.
      await new EditorPage(a).setContent({
        type: "doc",
        content: [
          heading(1, "Title"),
          heading(2, "Alpha"),
          heading(2, "Gamma"),
          heading(2, "Beta"),
          heading(2, "Delta"),
        ],
      });
      const b = await openUser("slot-b");
      await expect(b.locator(".tiptap h2", { hasText: "Beta" })).toBeVisible();
      await caretIn(b, "Beta");
      const up = slot(b).getByRole("button", { name: "Move section up" });
      await expect(up).toBeVisible();
      await up.focus();

      // A deletes "Beta" (and its body); B's caret maps into another block.
      await a.evaluate(() => {
        const editor = window.__tiptap_editor;
        if (!editor) throw new Error("editor missing");
        let from = -1;
        let to = -1;
        editor.state.doc.forEach((node, pos) => {
          if (node.textContent === "Beta") {
            from = pos;
            to = pos + node.nodeSize;
          }
        });
        editor.view.dispatch(editor.state.tr.delete(from, to));
      });
      await expect(b.locator(".tiptap h2", { hasText: "Beta" })).toHaveCount(0);
      // Focus never drops to <body>; the held control stays put.
      await expect(up).toBeFocused();
      await b.keyboard.press("Enter");
      await b.waitForTimeout(300);
      const order = await a.evaluate(() => {
        const names: string[] = [];
        window.__tiptap_editor?.state.doc.forEach((node) => {
          if (node.type.name === "heading") names.push(node.textContent);
        });
        return names;
      });
      expect(order).toEqual(["Title", "Alpha", "Gamma", "Delta"]);
    } finally {
      await Promise.all(contexts.map((ctx) => ctx.close()));
    }
  });
});

test.describe("formatting", () => {
  test("More formatting > Clear formatting keeps the link", async ({
    page,
  }) => {
    await openDoc(page);
    await page.evaluate(() => {
      const editor = window.__tiptap_editor;
      if (!editor) throw new Error("editor missing");
      let from = -1;
      editor.state.doc.descendants((node, pos) => {
        if (from < 0 && node.isText && node.text === "Styled") from = pos;
      });
      editor
        .chain()
        .focus()
        .setTextSelection({ from, to: from + 6 })
        .run();
    });
    await toolbarButton(page, "More formatting").click();
    await page.getByRole("menuitem", { name: /Clear formatting/ }).click();
    const marks = await page.evaluate(() => {
      const editor = window.__tiptap_editor;
      let names: string[] = [];
      editor?.state.doc.descendants((node) => {
        if (node.isText && node.text === "Styled") {
          names = node.marks.map((mark) => mark.type.name);
        }
      });
      return names;
    });
    expect(marks).toEqual(["hyperlink"]);
  });

  test("read-only keeps every control in place and focused", async ({
    page,
  }) => {
    await openDoc(page);
    await caretIn(page, "Plain");
    // D1's registry controls; D2's stand-ins (colour, Insert) follow later.
    const registryIds = () =>
      toolbar(page).evaluate((root) =>
        Array.from(root.querySelectorAll("[data-action-id]")).map((el) =>
          el.getAttribute("data-action-id"),
        ),
      );
    const before = await registryIds();
    const indent = toolbarButton(page, "Indent");
    await indent.focus();
    await page.evaluate(() => window.__tiptap_editor?.setEditable(false));
    await expect(indent).toHaveAttribute("aria-disabled", "true");
    await expect(indent).toHaveAccessibleDescription(
      "This document is read-only.",
    );
    await expect(indent).toBeFocused();
    expect(await registryIds()).toEqual(before);
    await expect(toolbarButton(page, "Normal text")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});

test.describe("catch-up render budget", () => {
  test("a typing burst in a 500-heading doc keeps toolbar renders bounded", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const editorPage = new EditorPage(page);
    await editorPage.goto();
    await editorPage.waitForSync();
    // Plain content keeps 500 headings under the dev server's size cap.
    await editorPage.setContent(
      generateLargeDocument(500, { shape: "mixed", richContent: false }),
    );
    await page.locator(".tiptap h1").first().click();
    await expect(page.locator(".tiptap")).toBeFocused();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      window.__toolbarRenderMs = [];
      window.__toolbarCommits = 0;
    });
    const start = Date.now();
    // The input rule turns the paragraph into a heading mid-burst, so the
    // style menu, the slot and the section tools all have to catch up.
    await page.keyboard.type(`## ${"a".repeat(147)}`, { delay: 20 });
    const burstMs = Date.now() - start;
    await page.waitForTimeout(TOOLBAR_SETTLE_MS + 200);
    const renders = await page.evaluate(() => window.__toolbarRenderMs ?? []);
    const max = Math.max(0, ...renders);
    const sum = renders.reduce((a, b) => a + b, 0);
    console.log(
      `toolbar catch-up: commits=${renders.length} max=${max.toFixed(1)}ms sum=${sum.toFixed(1)}ms burst=${burstMs}ms`,
    );
    writeReport(`toolbar-catch-up-${Date.now()}.json`, {
      timestamp: new Date().toISOString(),
      headings: 500,
      keystrokes: 150,
      burstMs,
      commits: renders.length,
      maxMs: max,
      sumMs: sum,
      renders,
    });
    expect(renders.length).toBeGreaterThanOrEqual(1); // the probe is wired
    // Leaf subscriptions: only controls whose view changed re-render, so a
    // catch-up stays far below a long task (50 ms) even in a dev build. The
    // commit count per settle window is asserted in toolbar.spec.ts.
    expect(max).toBeLessThanOrEqual(50);
  });
});

test.describe("screenshots", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`row and slot (${theme})`, async ({ page }) => {
      await setTheme(page, theme);
      await page.setViewportSize({ width: 1400, height: 700 });
      await openDoc(page);
      const dir = path.join(process.cwd(), ".superpowers", "screens-D1");
      mkdirSync(dir, { recursive: true });
      for (const [where, needle] of [
        ["paragraph", "Plain"],
        ["heading", "Beta"],
        ["code", "const"],
        ["table", "Cell A"],
      ] as const) {
        await caretIn(page, needle);
        await page.waitForTimeout(150);
        await toolbar(page).screenshot({
          path: path.join(dir, `row-${where}-${theme}.png`),
        });
      }
      await toolbarButton(page, "More formatting").click();
      await page.waitForTimeout(200);
      await page.screenshot({
        path: path.join(dir, `overflow-${theme}.png`),
        clip: { x: 0, y: 0, width: 1400, height: 320 },
      });
    });
  }
});
