import { afterEach, describe, expect, it } from "bun:test";

import type { Editor } from "@tiptap/core";
import { AllSelection, TextSelection } from "@tiptap/pm/state";

import { styleFace } from "@/components/smart-toolbar/bubble/style-face";

import { createTestEditor } from "../../helpers/create-test-editor";
import {
  blockquote,
  bulletList,
  codeBlock,
  doc,
  h1,
  h2,
  listItem,
  orderedList,
  p,
  posInside,
  taskItem,
  taskList,
} from "../../helpers/document-builders";

let editor: Editor;

function setup(...blocks: Parameters<typeof doc>) {
  editor = createTestEditor({ content: doc(...blocks).toJSON() });
}

afterEach(() => editor?.destroy());

/** Selects `from` through `to` (two words of the doc) as a text range. */
function selectBetween(from: string, to: string) {
  const start = posInside(editor, from);
  const end = posInside(editor, to) + 1;
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, start, end),
    ),
  );
}

function caretIn(word: string) {
  editor.commands.setTextSelection(posInside(editor, word));
}

describe("styleFace", () => {
  it("names a paragraph Text, a heading by level and the first H1 Title", () => {
    setup(h1("Title"), h2("Section"), p("Body"));
    caretIn("Body");
    expect(styleFace(editor.state)).toBe("Text");
    caretIn("Section");
    expect(styleFace(editor.state)).toBe("H2");
    caretIn("Title");
    expect(styleFace(editor.state)).toBe("Title");
  });

  it("names bullet, ordered and task items List and a blockquote Quote", () => {
    setup(
      h1("Title"),
      bulletList(listItem(p("Bullet"))),
      orderedList(listItem(p("Ordered"))),
      taskList(taskItem(p("Task"))),
      blockquote(p("Quoted")),
      codeBlock("const x = 1;"),
    );
    for (const word of ["Bullet", "Ordered", "Task"]) {
      caretIn(word);
      expect(styleFace(editor.state)).toBe("List");
    }
    caretIn("Quoted");
    expect(styleFace(editor.state)).toBe("Quote");
    caretIn("const");
    expect(styleFace(editor.state)).toBe("Code");
  });

  it("is Mixed across a paragraph and a heading", () => {
    setup(h1("Title"), p("Body"), h2("Section"));
    selectBetween("Body", "Section");
    expect(styleFace(editor.state)).toBe("Mixed");
  });

  it("is one type across blocks that share it", () => {
    setup(h1("Title"), p("One"), p("Two"));
    selectBetween("One", "Two");
    expect(styleFace(editor.state)).toBe("Text");
  });

  it("is Mixed for select all, which includes the title", () => {
    setup(h1("Title"), p("Body"));
    editor.view.dispatch(
      editor.state.tr.setSelection(new AllSelection(editor.state.doc)),
    );
    expect(styleFace(editor.state)).toBe("Mixed");
  });

  it("returns at the second distinct type: 2,000 paragraphs visit 2 blocks", () => {
    setup(
      h1("Title"),
      p("Start"),
      h2("Break"),
      ...Array.from({ length: 2_000 }, (_, i) => p(`Filler ${i}`)),
    );
    selectBetween("Start", "Filler 1999");
    const { doc: root } = editor.state;
    const child = root.child.bind(root);
    let visits = 0;
    let walked = false;
    root.child = (index: number) => {
      visits += 1;
      return child(index);
    };
    root.nodesBetween = () => {
      walked = true;
    };
    expect(styleFace(editor.state)).toBe("Mixed");
    expect(visits).toBeLessThanOrEqual(2);
    expect(walked).toBe(false);
  });
});
