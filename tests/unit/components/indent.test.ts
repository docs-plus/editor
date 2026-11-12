import { afterEach, describe, expect, it } from "bun:test";

import type { Editor, JSONContent } from "@tiptap/core";

import {
  applyIndent,
  canApplyIndent,
} from "@/components/tiptap-ui/indent-button/indent-button";

import { createTestEditor } from "../../helpers/create-test-editor";
import { doc, h1, p, posInside } from "../../helpers/document-builders";

let editor: Editor;

afterEach(() => editor?.destroy());

const para = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const title = para("T");
title.type = "heading";
title.attrs = { level: 1 };

const list = (...items: string[]): JSONContent => ({
  type: "bulletList",
  content: items.map((t) => ({ type: "listItem", content: [para(t)] })),
});
const taskList = (...items: string[]): JSONContent => ({
  type: "taskList",
  content: items.map((t) => ({
    type: "taskItem",
    attrs: { checked: false },
    content: [para(t)],
  })),
});
const make = (...blocks: JSONContent[]) => {
  editor = createTestEditor({
    content: { type: "doc", content: [title, ...blocks] },
  });
};
const json = (e: Editor) => e.getJSON() as JSONContent;
const nestedType = (e: Editor) =>
  json(e).content?.[1].content?.[0].content?.[1]?.type;

describe("indent button gate and action", () => {
  it("indents the second list item like Tab", () => {
    make(list("one", "two"));
    editor.commands.setTextSelection(posInside(editor, "two"));
    expect(canApplyIndent(editor, "indent")).toBe(true);
    expect(applyIndent(editor, "indent")).toBe(true);
    expect(nestedType(editor)).toBe("bulletList");
  });

  it("cannot indent the first list item", () => {
    make(list("one", "two"));
    editor.commands.setTextSelection(posInside(editor, "one"));
    expect(canApplyIndent(editor, "indent")).toBe(false);
  });

  it("outdents a nested item like Shift+Tab", () => {
    make(list("one", "two"));
    editor.commands.setTextSelection(posInside(editor, "two"));
    applyIndent(editor, "indent");
    editor.commands.setTextSelection(posInside(editor, "two"));
    expect(canApplyIndent(editor, "outdent")).toBe(true);
    expect(applyIndent(editor, "outdent")).toBe(true);
    expect(nestedType(editor)).toBeUndefined();
    expect(json(editor).content?.[1].content).toHaveLength(2);
  });

  it("sinks every item in a range", () => {
    make(list("one", "two", "three"));
    editor.commands.setTextSelection({
      from: posInside(editor, "two"),
      to: posInside(editor, "three"),
    });
    expect(applyIndent(editor, "indent")).toBe(true);
    const items = json(editor).content?.[1].content;
    expect(items).toHaveLength(1);
    expect(items?.[0].content?.[1].content).toHaveLength(2);
  });

  it("indents task items", () => {
    make(taskList("one", "two"));
    editor.commands.setTextSelection(posInside(editor, "two"));
    expect(canApplyIndent(editor, "indent")).toBe(true);
    expect(applyIndent(editor, "indent")).toBe(true);
    expect(nestedType(editor)).toBe("taskList");
  });

  it("still indents a plain paragraph", () => {
    editor = createTestEditor({ content: doc(h1("T"), p("x")).toJSON() });
    editor.commands.setTextSelection(posInside(editor, "x"));
    expect(canApplyIndent(editor, "indent")).toBe(true);
    expect(applyIndent(editor, "indent")).toBe(true);
    expect(editor.getText()).toContain("  x");
  });

  it("never moves between table cells", () => {
    make({
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [para("a")] },
            { type: "tableCell", content: [para("b")] },
          ],
        },
      ],
    });
    editor.commands.setTextSelection(posInside(editor, "a"));
    const before = editor.state.selection.from;
    expect(canApplyIndent(editor, "indent")).toBe(false);
    expect(applyIndent(editor, "indent")).toBe(false);
    expect(editor.state.selection.from).toBe(before);
  });
});
