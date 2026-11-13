import { mkdirSync, readFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import {
  FONT_SIZE_TOKENS,
  HIGHLIGHT_PALETTE,
  HIGHLIGHT_TOKENS,
  TEXT_COLOR_PALETTE,
  TEXT_COLOR_TOKENS,
} from "@/lib/text-style-tokens";

import { resolveRgb, setTheme } from "./helpers/a11y";
import { EditorPage } from "./helpers/editor-page";

const SCREENS = ".superpowers/screens-C";

const text = (value: string, marks: object[] = []) => ({
  type: "text",
  text: value,
  ...(marks.length ? { marks } : {}),
});
const paragraph = (...content: object[]) => ({ type: "paragraph", content });

/** Every colour, highlight and size, plus a sized run in a heading. */
const PALETTE_DOC = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [text("Text style palette")],
    },
    paragraph(
      ...TEXT_COLOR_TOKENS.flatMap((color) => [
        text(color, [{ type: "textColor", attrs: { color } }]),
        text(" "),
      ]),
    ),
    paragraph(
      ...HIGHLIGHT_TOKENS.flatMap((color) => [
        text(color, [{ type: "highlight", attrs: { color } }]),
        text(" "),
      ]),
    ),
    paragraph(
      ...FONT_SIZE_TOKENS.flatMap((size) => [
        text(`Size ${size}`, [{ type: "fontSize", attrs: { size } }]),
        text(" "),
      ]),
      text("Size md"),
    ),
    {
      type: "heading",
      attrs: { level: 2 },
      content: [text("A heading")],
    },
  ],
};

async function openDoc(page: Page) {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForSync();
  return editor;
}

/** Dispatches a real `paste` event carrying `html` on the editor. */
async function pasteHtml(page: Page, html: string) {
  await page.evaluate((value) => {
    const data = new DataTransfer();
    data.setData("text/html", value);
    data.setData(
      "text/plain",
      new DOMParser().parseFromString(value, "text/html").body.textContent ??
        "",
    );
    document.querySelector(".tiptap")?.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, html);
}

/** ProseMirror's own clipboard HTML for the current selection. */
async function copySelectionHtml(page: Page): Promise<string> {
  return page.evaluate(() => {
    const data = new DataTransfer();
    document.querySelector(".tiptap")?.dispatchEvent(
      new ClipboardEvent("copy", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
    return data.getData("text/html");
  });
}

/** Caret at the end of the last paragraph of a two-block doc. */
async function seedEmptyBody(editor: EditorPage, page: Page) {
  await editor.setContent({
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [text("Paste here")] },
      { type: "paragraph" },
    ],
  });
  await page.evaluate(() => {
    const e = window.__tiptap_editor;
    e?.chain()
      .focus()
      .setTextSelection(e.state.doc.content.size - 1)
      .run();
  });
}

test.describe("text style marks", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`renders the Appendix A palette without inline style (${theme})`, async ({
      page,
    }) => {
      await setTheme(page, theme);
      const editor = await openDoc(page);
      await editor.setContent(PALETTE_DOC);

      const html = await page.locator(".tiptap").innerHTML();
      expect(html).not.toMatch(/style="[^"]*(color|font-size|background)/);

      for (const token of TEXT_COLOR_TOKENS) {
        const color = await page
          .locator(`.tiptap span[data-text-color="${token}"]`)
          .evaluate((el) => getComputedStyle(el).color);
        expect(await resolveRgb(page, color)).toEqual(
          await resolveRgb(page, TEXT_COLOR_PALETTE[token][theme]),
        );
      }
      for (const token of HIGHLIGHT_TOKENS) {
        const color = await page
          .locator(`.tiptap mark[data-highlight="${token}"]`)
          .evaluate((el) => getComputedStyle(el).backgroundColor);
        expect(await resolveRgb(page, color)).toEqual(
          await resolveRgb(page, HIGHLIGHT_PALETTE[token][theme]),
        );
      }

      const sizes = await page
        .locator(".tiptap p span[data-font-size]")
        .evaluateAll((els) =>
          els.map((el) => Number.parseFloat(getComputedStyle(el).fontSize)),
        );
      const base = await page
        .locator(".tiptap p")
        .nth(2)
        .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
      expect(sizes.map((s) => +(s / base).toFixed(3))).toEqual([
        0.75, 0.875, 1.25, 1.5,
      ]);

      mkdirSync(SCREENS, { recursive: true });
      await page
        .locator(".tiptap")
        .screenshot({ path: `${SCREENS}/palette-${theme}.png` });
    });
  }

  test("a size that reaches a heading remotely renders at heading size", async ({
    page,
  }) => {
    const editor = await openDoc(page);
    await editor.setContent(PALETTE_DOC);
    // Mark the h2 the way a remote Yjs update would: the heading guard
    // never rewrites those, so only CSS keeps the heading's size.
    await page.evaluate(() => {
      const e = window.__tiptap_editor;
      if (!e) return;
      const { state } = e;
      const sync = state.plugins.find((p) =>
        (p as unknown as { key: string }).key.startsWith("y-sync"),
      );
      let from = 0;
      let to = 0;
      state.doc.descendants((node, pos) => {
        if (node.type.name === "heading" && node.attrs.level === 2) {
          from = pos + 1;
          to = pos + node.nodeSize - 1;
        }
      });
      const tr = state.tr.addMark(
        from,
        to,
        state.schema.marks.fontSize.create({ size: "xl" }),
      );
      if (sync) tr.setMeta(sync, { isChangeOrigin: true });
      e.view.dispatch(tr);
    });
    const span = page.locator(".tiptap h2 span[data-font-size='xl']");
    await expect(span).toHaveCount(1);
    const [spanSize, headingSize] = await Promise.all([
      span.evaluate((el) => getComputedStyle(el).fontSize),
      page
        .locator(".tiptap h2")
        .evaluate((el) => getComputedStyle(el).fontSize),
    ]);
    expect(spanSize).toBe(headingSize);
  });

  test("turning a sized paragraph into a heading drops the size in one Yjs undo step", async ({
    page,
  }) => {
    const editor = await openDoc(page);
    await editor.setContent({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [text("Undo")] },
        paragraph(text("big", [{ type: "fontSize", attrs: { size: "lg" } }])),
      ],
    });
    // Past the Yjs UndoManager capture window, so setContent is its own step.
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      window.__tiptap_editor
        ?.chain()
        .focus()
        .setTextSelection(8)
        .toggleHeading({ level: 2 })
        .run();
    });
    await expect(page.locator(".tiptap h2")).toHaveText("big");
    await expect(page.locator(".tiptap [data-font-size]")).toHaveCount(0);

    // Tiptap's focus() lands a frame later; Mod-Z before it is lost.
    await expect(page.locator(".tiptap")).toBeFocused();
    await editor.undo();
    await expect(
      page.locator('.tiptap p span[data-font-size="lg"]'),
    ).toHaveText("big");
    await expect(page.locator(".tiptap h2")).toHaveCount(0);
  });

  test("tab-to-tab paste keeps colour, size and highlight tokens", async ({
    page,
    context,
  }) => {
    const source = await openDoc(page);
    await source.setContent({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [text("Source")] },
        paragraph(
          text("Red", [{ type: "textColor", attrs: { color: "red" } }]),
          text(" "),
          text("Large", [{ type: "fontSize", attrs: { size: "lg" } }]),
          text(" "),
          text("Marked", [{ type: "highlight", attrs: { color: "teal" } }]),
        ),
      ],
    });
    await page.evaluate(() => {
      const e = window.__tiptap_editor;
      e?.chain().focus().setTextSelection({ from: 9, to: 25 }).run();
    });
    const html = await copySelectionHtml(page);
    expect(html).toContain('data-text-color="red"');
    expect(html).not.toContain("style=");

    const targetPage = await context.newPage();
    const target = await openDoc(targetPage);
    await seedEmptyBody(target, targetPage);
    await pasteHtml(targetPage, html);
    await expect(
      targetPage.locator('.tiptap p span[data-text-color="red"]'),
    ).toHaveText("Red");
    await expect(
      targetPage.locator('.tiptap p span[data-font-size="lg"]'),
    ).toHaveText("Large");
    await expect(
      targetPage.locator('.tiptap p mark[data-highlight="teal"]'),
    ).toHaveText("Marked");
  });

  // Synthetic fixtures: NOT checked against a real clipboard.
  for (const name of ["google-docs", "word"]) {
    test(`${name} sample pastes plain (synthetic fixture)`, async ({
      page,
    }) => {
      const html = readFileSync(
        `tests/fixtures/clipboard/${name}.html`,
        "utf8",
      );
      const editor = await openDoc(page);
      await seedEmptyBody(editor, page);
      await pasteHtml(page, html);
      await expect(page.locator(".tiptap")).toContainText(
        "Red Large Marked Plain",
      );
      await expect(
        page.locator(
          ".tiptap [data-text-color], .tiptap [data-font-size], .tiptap mark",
        ),
      ).toHaveCount(0);
      expect(await page.locator(".tiptap").innerHTML()).not.toMatch(
        /style="[^"]*(color|font-size|background)/i,
      );
    });
  }
});
