import { afterEach, describe, expect, it } from "bun:test";

import type { Editor, JSONContent } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";

import { computeContext } from "@/lib/editor-context/snapshot";

import { createTestEditor } from "../../helpers/create-test-editor";

const text = (value: string, marks?: JSONContent["marks"]): JSONContent => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const p = (value: string, marks?: JSONContent["marks"]): JSONContent => ({
  type: "paragraph",
  content: value ? [text(value, marks)] : [],
});
const h = (level: number, value: string, id?: string): JSONContent => ({
  type: "heading",
  attrs: { level, ...(id ? { id } : {}) },
  content: [text(value)],
});
const cell = (value: string): JSONContent => ({
  type: "tableCell",
  content: [p(value)],
});

const DOC: JSONContent = {
  type: "doc",
  content: [
    h(1, "Title", "t"),
    p("Plain"),
    h(2, "Section", "s2"),
    {
      type: "bulletList",
      content: [{ type: "listItem", content: [p("Item")] }],
    },
    {
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [text("const a = 1;")],
    },
    {
      type: "codeBlock",
      attrs: { language: "mermaid" },
      content: [text("graph TD; A-->B")],
    },
    {
      type: "table",
      content: [
        { type: "tableRow", content: [cell("A1"), cell("B1")] },
        { type: "tableRow", content: [cell("A2"), cell("B2")] },
      ],
    },
    { type: "image", attrs: { src: "https://example.com/a.png" } },
    { type: "blockquote", content: [p("Quoted")] },
    p("Bold", [{ type: "bold" }]),
  ],
};

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function setup(): Editor {
  editor = createTestEditor({ content: DOC });
  return editor;
}

/** Position just inside the first text that equals `needle`. */
function posOf(target: Editor, needle: string): number {
  let found = -1;
  target.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.isText && node.text?.startsWith(needle)) found = pos;
    return true;
  });
  if (found < 0) throw new Error(`no text ${needle}`);
  return found;
}

function caretIn(target: Editor, needle: string): void {
  target.commands.setTextSelection(posOf(target, needle));
}

function nodePos(target: Editor, type: string): number {
  let found = -1;
  target.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.type.name === type) found = pos;
    return true;
  });
  return found;
}

describe("computeContext kind", () => {
  it.each([
    ["paragraph", "Plain"],
    ["title", "Title"],
    ["heading", "Section"],
    ["list", "Item"],
    ["code", "const"],
    ["mermaid", "graph"],
    ["table", "A1"],
    ["paragraph", "Quoted"],
  ])("is %s with the caret in %s", (kind, needle) => {
    const target = setup();
    caretIn(target, needle);
    expect(computeContext(target).kind).toBe(kind as never);
  });

  it("is media for an image NodeSelection", () => {
    const target = setup();
    const pos = nodePos(target, "image");
    target.view.dispatch(
      target.state.tr.setSelection(NodeSelection.create(target.state.doc, pos)),
    );
    const ctx = computeContext(target);
    expect(ctx.kind).toBe("media");
    expect(ctx.nodeSelectionType).toBe("image");
  });

  it("is table for a CellSelection over two cells", () => {
    const target = setup();
    const a = target.state.doc.resolve(posOf(target, "A1") - 2);
    const b = target.state.doc.resolve(posOf(target, "B1") - 2);
    target.view.dispatch(target.state.tr.setSelection(new CellSelection(a, b)));
    const ctx = computeContext(target);
    expect(ctx.kind).toBe("table");
    expect(ctx.inTable).toBe(true);
  });

  it("keeps kind structural in a read-only document", () => {
    const target = setup();
    caretIn(target, "const");
    target.setEditable(false);
    const ctx = computeContext(target);
    expect(ctx.kind).toBe("code");
    expect(ctx.editable).toBe(false);
  });
});

describe("computeContext flags", () => {
  it("reads title, heading level and id", () => {
    const target = setup();
    caretIn(target, "Title");
    const title = computeContext(target);
    expect(title.isTitle).toBe(true);
    expect(title.headingLevel).toBe(1);
    caretIn(target, "Section");
    const section = computeContext(target);
    expect(section.isTitle).toBe(false);
    expect(section.headingLevel).toBe(2);
    expect(section.headingId).toBe("s2");
  });

  it("reads ancestor flags", () => {
    const target = setup();
    caretIn(target, "Item");
    expect(computeContext(target).inList).toBe(true);
    caretIn(target, "Quoted");
    expect(computeContext(target).inBlockquote).toBe(true);
    caretIn(target, "const");
    const code = computeContext(target);
    expect(code.inCodeBlock).toBe(true);
    expect(code.parentType).toBe("codeBlock");
    caretIn(target, "A1");
    expect(computeContext(target).inTable).toBe(true);
    caretIn(target, "Plain");
    const plain = computeContext(target);
    expect([plain.inList, plain.inTable, plain.inBlockquote]).toEqual([
      false,
      false,
      false,
    ]);
    expect(plain.empty).toBe(true);
  });

  it("reads marks at the caret, and stored marks win", () => {
    const target = setup();
    target.commands.setTextSelection(posOf(target, "Bold") + 1);
    expect([...computeContext(target).activeMarks]).toEqual(["bold"]);
    target.commands.setTextSelection(posOf(target, "Plain") + 1);
    target.commands.setMark("italic");
    expect([...computeContext(target).activeMarks]).toEqual(["italic"]);
  });

  it("reads marks active across the whole range only", () => {
    const target = setup();
    const from = posOf(target, "Bold");
    target.view.dispatch(
      target.state.tr.setSelection(
        TextSelection.create(target.state.doc, from, from + 4),
      ),
    );
    expect(computeContext(target).activeMarks.has("bold")).toBe(true);
    const plain = posOf(target, "Plain");
    target.view.dispatch(
      target.state.tr.setSelection(
        TextSelection.create(target.state.doc, plain, from + 2),
      ),
    );
    expect(computeContext(target).activeMarks.has("bold")).toBe(false);
  });
});
