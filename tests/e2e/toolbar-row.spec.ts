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

const MEDIA_SVG = encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#888"/></svg>',
);

/** Every slot kind: the shared doc plus a Mermaid block and an image. */
const SLOT_DOC = {
  ...DOC,
  content: [
    ...DOC.content,
    {
      type: "codeBlock",
      attrs: { language: "mermaid" },
      content: [text("graph TD; A-->B")],
    },
    {
      type: "image",
      attrs: { src: `data:image/svg+xml,${MEDIA_SVG}`, alt: "Sample" },
    },
    paragraph(text("After media")),
  ],
};

/** Selects the first image as a NodeSelection with the editor focused. */
async function selectImage(page: Page): Promise<void> {
  await page.evaluate(() => {
    const editor = window.__tiptap_editor;
    if (!editor) throw new Error("editor missing");
    let pos = -1;
    editor.state.doc.descendants((node, p) => {
      if (pos < 0 && node.type.name === "image") pos = p;
      return pos < 0;
    });
    editor.chain().setNodeSelection(pos).focus().run();
  });
  await expect(page.locator(".tiptap")).toBeFocused();
  await expect(slot(page)).toHaveAttribute("data-kind", "media");
}

/** Arrows through the toolbar from Alt+F10 until `name` has focus. */
async function arrowTo(page: Page, name: string): Promise<void> {
  await page.keyboard.press("Alt+F10");
  for (let i = 0; i < 60; i++) {
    const label = await page.evaluate(() =>
      document.activeElement?.getAttribute("aria-label"),
    );
    if (label === name) return;
    await page.keyboard.press("ArrowRight");
  }
  throw new Error(`never reached ${name}`);
}

/** WCAG 1.4.12 text spacing, as a user stylesheet would apply it. */
const TEXT_SPACING_CSS = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
p { margin-bottom: 2em !important; }`;

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
    // A focus tooltip takes the first Esc (WCAG 1.4.13); never more than two.
    for (let press = 0; press < 2; press += 1) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(100);
      if (
        await page
          .locator(".tiptap")
          .evaluate((el) => el === document.activeElement)
      )
        break;
    }
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

test.describe("context slot fit and focus (WCAG 1.4.12, 2.4.11)", () => {
  test("no slot kind overflows its fixed width with text spacing", async ({
    page,
  }) => {
    const editorPage = new EditorPage(page);
    await editorPage.goto();
    await editorPage.waitForSync();
    await editorPage.setContent(SLOT_DOC);
    await page.addStyleTag({ content: TEXT_SPACING_CSS });
    const fits = async () =>
      slot(page).evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
      }));
    for (const [kind, needle] of [
      ["title", "Title"],
      ["heading", "Alpha"],
      ["code", "const"],
      ["mermaid", "graph"],
      ["table", "Cell A"],
    ] as const) {
      await caretIn(page, needle);
      await expect(slot(page)).toHaveAttribute("data-kind", kind);
      const { scroll, client } = await fits();
      expect(scroll, `${kind} slot`).toBeLessThanOrEqual(client);
    }
    await selectImage(page);
    const { scroll, client } = await fits();
    expect(scroll, "media slot").toBeLessThanOrEqual(client);
  });

  test("a focused slot control keeps its whole focus outline", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 700 });
    const editorPage = new EditorPage(page);
    await editorPage.goto();
    await editorPage.waitForSync();
    await editorPage.setContent(SLOT_DOC);
    await caretIn(page, "graph");
    const trigger = slot(page).getByRole("button", { name: "Mermaid diagram" });
    await arrowTo(page, "Mermaid diagram");
    await expect(trigger).toBeFocused();
    // Nothing between the control and the toolbar clips its outline.
    const clipped = await trigger.evaluate((el) => {
      let node = el.parentElement;
      while (node && node.getAttribute("role") !== "toolbar") {
        const style = getComputedStyle(node);
        if (style.overflowX !== "visible" || style.overflowY !== "visible") {
          return node.getAttribute("data-slot") ?? node.tagName;
        }
        node = node.parentElement;
      }
      return null;
    });
    expect(clipped).toBeNull();
    const dir = path.join(process.cwd(), ".superpowers", "screens-D1");
    mkdirSync(dir, { recursive: true });
    await toolbar(page).screenshot({
      path: path.join(dir, "slot-focused-mermaid.png"),
    });
    await selectImage(page);
    await toolbar(page).screenshot({
      path: path.join(dir, "slot-media.png"),
    });
    await caretIn(page, "Title");
    await toolbar(page).screenshot({
      path: path.join(dir, "slot-title.png"),
    });
  });
});

test.describe("media options by keyboard (WCAG 2.1.1)", () => {
  test("opens the kit toolbar with focus inside and Esc returns", async ({
    page,
  }) => {
    const editorPage = new EditorPage(page);
    await editorPage.goto();
    await editorPage.waitForSync();
    await editorPage.setContent(SLOT_DOC);
    await page.locator('.tiptap img[alt="Sample"]').scrollIntoViewIfNeeded();
    await selectImage(page);
    await arrowTo(page, "Media options…");
    const button = slot(page).getByRole("button", { name: "Media options…" });
    await expect(button).toBeFocused();
    await page.keyboard.press("Enter");
    await expect
      .poll(() =>
        page.evaluate(
          () => !!document.activeElement?.closest("[data-hm-toolbar]"),
        ),
      )
      .toBe(true);
    await page.keyboard.press("Escape");
    await expect(button).toBeFocused();
    await expect(
      page.locator("[data-hm-toolbar]:not([data-hm-closing])"),
    ).toHaveCount(0);
  });
});

test.describe("toolbar keys", () => {
  test("Esc first closes a focus tooltip, then returns to the editor", async ({
    page,
  }) => {
    await openDoc(page);
    await caretIn(page, "Plain");
    await page.keyboard.press("Alt+F10");
    await page.keyboard.press("ArrowRight");
    const focused = page.locator(":focus");
    const name = await focused.getAttribute("aria-label");
    // Base UI marks the trigger while its tooltip is open.
    await expect(focused).toHaveAttribute("data-popup-open", "");
    const tips = page.locator('[data-slot="tooltip-content"]:visible');
    await expect(tips).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(tips).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        document.activeElement?.getAttribute("aria-label"),
      ),
    ).toBe(name);
    await page.keyboard.press("Escape");
    await expect(page.locator(".tiptap")).toBeFocused();
  });

  test("stays one Tab stop after the slot swaps while the editor has focus", async ({
    page,
  }) => {
    await openDoc(page);
    const tabStops = () =>
      toolbar(page).evaluate(
        (el) =>
          Array.from(el.querySelectorAll<HTMLElement>("button")).filter(
            (b) => b.tabIndex >= 0 && b.getAttribute("tabindex") !== "-1",
          ).length,
      );
    await caretIn(page, "Alpha");
    // The stop lives in the slot, then the slot swaps under it.
    await arrowTo(page, "Fold section");
    await page.keyboard.press("Escape");
    for (const needle of ["const", "Cell A", "Beta", "Plain", "Alpha"]) {
      await caretIn(page, needle);
      await page.waitForTimeout(50);
      expect(await tabStops(), needle).toBe(1);
    }
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

  test("arrow and Shift+Arrow p95 in a 500-heading doc", async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    const measure = async (target: Page) => {
      const editorPage = new EditorPage(target);
      await editorPage.goto();
      await editorPage.waitForSync();
      await editorPage.setContent(
        generateLargeDocument(500, { shape: "mixed", richContent: false }),
      );
      await target.locator(".tiptap h1").first().click();
      await expect(target.locator(".tiptap")).toBeFocused();
      await target.waitForTimeout(500);
      // Keydown to the first task after the next frame: the key's own
      // work, the toolbar's and the paint.
      await target.evaluate(() => {
        const w = window as unknown as { __keyMs: number[] };
        w.__keyMs = [];
        window.addEventListener(
          "keydown",
          () => {
            const start = performance.now();
            requestAnimationFrame(() =>
              setTimeout(() => w.__keyMs.push(performance.now() - start), 0),
            );
          },
          true,
        );
      });
      const p95 = async (keys: string[]) => {
        await target.evaluate(() => {
          (window as unknown as { __keyMs: number[] }).__keyMs = [];
        });
        for (const key of keys) {
          await target.keyboard.press(key);
          await target.waitForTimeout(30);
        }
        const ms = await target.evaluate(
          () => (window as unknown as { __keyMs: number[] }).__keyMs,
        );
        const sorted = [...ms].sort((a, b) => a - b);
        return sorted[
          Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
        ];
      };
      // Down through headings, paragraphs and code: the slot swaps often.
      const arrow = await p95(Array(60).fill("ArrowDown"));
      await target.keyboard.press("ControlOrMeta+a");
      await target.waitForTimeout(300);
      const shift = await p95(Array(30).fill("Shift+ArrowLeft"));
      return { arrow, shift };
    };
    const withToolbar = await measure(page);
    // The same keys with the toolbar unmounted: the editor's own cost.
    const bare = await context.newPage();
    await bare.addInitScript("window.__TOOLBAR_OFF = true");
    const withoutToolbar = await measure(bare);
    await bare.close();
    const arrowDelta = withToolbar.arrow - withoutToolbar.arrow;
    const shiftDelta = withToolbar.shift - withoutToolbar.shift;
    console.log(
      `500 headings p95 (dev build): arrow ${withToolbar.arrow.toFixed(1)}ms vs ${withoutToolbar.arrow.toFixed(1)}ms without toolbar; shift+arrow on select-all ${withToolbar.shift.toFixed(1)}ms vs ${withoutToolbar.shift.toFixed(1)}ms`,
    );
    writeReport(`toolbar-arrow-p95-${Date.now()}.json`, {
      timestamp: new Date().toISOString(),
      headings: 500,
      withToolbar,
      withoutToolbar,
    });
    // Loose ceilings on the toolbar's share: a regression to a full doc
    // walk per mark or a layout pass per slot swap lands far above them.
    expect(arrowDelta).toBeLessThanOrEqual(50);
    expect(shiftDelta).toBeLessThanOrEqual(50);
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
