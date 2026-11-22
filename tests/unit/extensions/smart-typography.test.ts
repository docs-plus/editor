import { afterEach, describe, expect, it } from "bun:test";

import type { Editor } from "@tiptap/core";

import { SmartTypography } from "@/extensions/smart-typography/smart-typography";
import {
  createTestEditor,
  DEFAULT_EXTENSIONS,
} from "@/tests/helpers/create-test-editor";

/** Types one character the way the browser does, through input rules. */
function type(editor: Editor, text: string): void {
  for (const char of text) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp("handleTextInput", (handle) =>
      handle(editor.view, from, to, char, () =>
        editor.state.tr.insertText(char, from, to),
      ),
    );
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(char));
  }
}

function editorWith(content: unknown): Editor {
  const editor = createTestEditor({
    extensions: [...DEFAULT_EXTENSIONS, SmartTypography],
    content: content as never,
  });
  // The end of the second block (a trailing paragraph may follow it).
  const { doc } = editor.state;
  editor.commands.setTextSelection(
    doc.child(0).nodeSize + doc.child(1).nodeSize - 1,
  );
  return editor;
}

const doc = (block: unknown) => ({
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "T" }],
    },
    block,
  ],
});
const paragraph = (text: string, marks?: unknown[]) => ({
  type: "paragraph",
  content: [{ type: "text", text, ...(marks ? { marks } : {}) }],
});

const block = (e: Editor) => e.state.doc.child(1).textContent;

let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
  delete document.documentElement.dataset.smartQuotes;
});

describe("smart quotes gate (Q2)", () => {
  it("curls quotes and dashes when on (today's behaviour)", () => {
    editor = editorWith(doc(paragraph("a")));
    type(editor, ' "b" --');
    expect(block(editor)).toBe("a “b” —");
  });

  it("types straight quotes and dashes when off, without rebuilding", () => {
    editor = editorWith(doc(paragraph("a")));
    document.documentElement.dataset.smartQuotes = "off";
    type(editor, ' "b" -- ->');
    expect(block(editor)).toBe('a "b" -- ->');
    delete document.documentElement.dataset.smartQuotes;
    type(editor, ' "c"');
    expect(block(editor)).toBe('a "b" -- -> “c”');
  });

  it("never touches a code block, with the setting on", () => {
    editor = editorWith(
      doc({ type: "codeBlock", content: [{ type: "text", text: "x" }] }),
    );
    type(editor, ' "y" -- ->');
    expect(block(editor)).toBe('x "y" -- ->');
  });

  it("never touches inline code, with the setting on", () => {
    editor = editorWith(doc(paragraph("x", [{ type: "inlineCode" }])));
    type(editor, ' "y" --');
    expect(block(editor)).toBe('x "y" --');
  });
});
