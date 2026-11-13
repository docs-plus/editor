import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { Editor, JSONContent } from "@tiptap/core";

import { editorActions } from "@/lib/editor-actions";
import { runAction } from "@/lib/editor-actions/registry";
import { LIST_TYPE_CHOICE, readChoice } from "@/lib/remembered-choice";

import { createTestEditor } from "../../helpers/create-test-editor";

const title: JSONContent = {
  type: "heading",
  attrs: { level: 1 },
  content: [{ type: "text", text: "Title" }],
};
const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const bulletList = (...items: string[]): JSONContent => ({
  type: "bulletList",
  content: items.map((text) => ({
    type: "listItem",
    content: [paragraph(text)],
  })),
});

let editor: Editor;

function open(content: JSONContent[]) {
  editor = createTestEditor({ content: { type: "doc", content } });
}

const run = (id: string, arg?: unknown) => {
  const action = editorActions.get(id);
  if (!action) throw new Error(`No action ${id}`);
  return runAction(editor, action, arg);
};

/** Puts the caret inside the first text of the given top-level block. */
function caretIn(index: number) {
  let pos = 0;
  for (let i = 0; i < index; i += 1) pos += editor.state.doc.child(i).nodeSize;
  let inner = pos;
  editor.state.doc.nodesBetween(
    pos,
    pos + editor.state.doc.child(index).nodeSize,
    (node, at) => {
      if (inner === pos && node.isTextblock) inner = at + 1;
    },
  );
  editor.commands.setTextSelection(inner + 1);
}

beforeEach(() => localStorage.clear());
afterEach(() => editor?.destroy());

describe("M9: list.* actions remember the list type", () => {
  it("a list action writes LIST_TYPE_CHOICE when it runs", () => {
    open([title, paragraph("hello")]);
    caretIn(1);
    expect(run("list.ordered")).toBe(true);
    expect(editor.state.doc.child(1).type.name).toBe("orderedList");
    expect(readChoice(LIST_TYPE_CHOICE).last).toBe("orderedList");
  });

  it("retypes a list in place, nested items included, as one step", () => {
    open([title, bulletList("one", "two")]);
    caretIn(1);
    expect(run("list.task")).toBe(true);
    const list = editor.state.doc.child(1);
    expect(list.type.name).toBe("taskList");
    expect(list.childCount).toBe(2);
    expect(readChoice(LIST_TYPE_CHOICE).last).toBe("taskList");
  });

  it("a refused run writes nothing", () => {
    open([title, paragraph("hello")]);
    caretIn(0); // the title
    run("list.task");
    expect(localStorage.getItem("tinydocy-choices")).toBeNull();
  });
});
