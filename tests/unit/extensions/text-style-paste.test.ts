import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

import type { Editor, JSONContent } from "@tiptap/core";

import { createTestEditor } from "@/tests/helpers/create-test-editor";

// happy-dom lacks the legacy `CSSStyleSheet.rules`, which ProseMirror reads
// when it inlines a pasted document's <style> (Word's clipboard has one).
const sheetProto = globalThis.CSSStyleSheet?.prototype;
if (sheetProto && !("rules" in sheetProto)) {
  Object.defineProperty(sheetProto, "rules", {
    get(this: CSSStyleSheet) {
      return this.cssRules;
    },
  });
}

const STYLE_MARKS = new Set(["textColor", "fontSize", "highlight"]);

const editors: Editor[] = [];
function make(content?: JSONContent) {
  const editor = createTestEditor({
    content: content ?? {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        { type: "paragraph" },
      ],
    },
  });
  editors.push(editor);
  return editor;
}
afterEach(() => {
  for (const e of editors) e.destroy();
  editors.length = 0;
});

function styleMarks(editor: Editor) {
  const out: { type: string; attrs: Record<string, unknown>; text: string }[] =
    [];
  editor.state.doc.descendants((node) => {
    for (const m of node.marks)
      if (STYLE_MARKS.has(m.type.name))
        out.push({ type: m.type.name, attrs: m.attrs, text: node.text ?? "" });
  });
  return out;
}

/** Caret in the empty paragraph after the title. */
const caretInBody = (editor: Editor) => editor.commands.setTextSelection(8);

describe("paste (P10)", () => {
  it("tab-to-tab: our own copy keeps colour, size and highlight tokens", () => {
    const source = make({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "T" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "Red",
              marks: [{ type: "textColor", attrs: { color: "red" } }],
            },
            { type: "text", text: " " },
            {
              type: "text",
              text: "Large",
              marks: [{ type: "fontSize", attrs: { size: "lg" } }],
            },
            { type: "text", text: " " },
            {
              type: "text",
              text: "Marked",
              marks: [{ type: "highlight", attrs: { color: "teal" } }],
            },
          ],
        },
      ],
    });
    source.commands.setTextSelection({ from: 4, to: 20 });
    const { dom } = source.view.serializeForClipboard(
      source.state.selection.content(),
    );
    const html = dom.innerHTML;
    expect(html).not.toContain("style=");

    const target = make();
    caretInBody(target);
    target.view.pasteHTML(html);
    expect(styleMarks(target)).toEqual([
      { type: "textColor", attrs: { color: "red" }, text: "Red" },
      { type: "fontSize", attrs: { size: "lg" }, text: "Large" },
      { type: "highlight", attrs: { color: "teal" }, text: "Marked" },
    ]);
  });

  it("a release N copy (legacy data-color) pastes as a token", () => {
    const target = make();
    caretInBody(target);
    target.view.pasteHTML(
      '<p><mark data-color="var(--tt-color-highlight-green)" style="background-color: var(--tt-color-highlight-green); color: inherit">old</mark></p>',
    );
    expect(styleMarks(target)).toEqual([
      { type: "highlight", attrs: { color: "green" }, text: "old" },
    ]);
  });

  // Synthetic fixtures: NOT checked against a real clipboard (contract §2.3).
  for (const name of ["google-docs", "word"]) {
    it(`${name} sample pastes plain (synthetic fixture)`, () => {
      const html = readFileSync(
        `tests/fixtures/clipboard/${name}.html`,
        "utf8",
      );
      // The sample really carries colour, size and background.
      expect(html).toMatch(/[;'"\s]color:/i);
      expect(html).toMatch(/font-size:/i);
      expect(html).toMatch(/background(-color)?:\s*(#ffff00|yellow)/i);

      const target = make();
      caretInBody(target);
      target.view.pasteHTML(html);
      expect(target.state.doc.textContent).toContain("Red Large Marked Plain");
      expect(styleMarks(target)).toEqual([]);
      expect(target.getHTML()).not.toMatch(
        /style=|data-text-color|data-font-size|<mark/,
      );
    });
  }
});
