import type { Editor, Extension } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import {
  CARET_BLOCK_CLASS,
  CaretBlockVisible,
  caretBlockPluginKey,
} from "@/extensions/render-once";
import {
  createTestEditor,
  DEFAULT_EXTENSIONS,
} from "@/tests/helpers/create-test-editor";

const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const DOC = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Title" }],
    },
    paragraph("one"),
    paragraph("two"),
    paragraph("three"),
  ],
};

let editor: Editor;

afterEach(() => editor?.destroy());

function setup(): Editor {
  editor = createTestEditor({
    content: DOC,
    extensions: [...DEFAULT_EXTENSIONS, CaretBlockVisible as Extension],
  });
  return editor;
}

/** Text of the top-level blocks that carry the caret class. */
function markedBlocks(): string[] {
  return Array.from(editor.view.dom.children)
    .filter((el) => el.classList.contains(CARET_BLOCK_CLASS))
    .map((el) => el.textContent ?? "");
}

/** Position just inside the start of the top-level block at `index`. */
function blockStart(index: number): number {
  let pos = 0;
  for (let i = 0; i < index; i++) pos += editor.state.doc.child(i).nodeSize;
  return pos + 1;
}

describe("CaretBlockVisible", () => {
  it("marks the block that holds the caret", () => {
    setup();
    editor.commands.setTextSelection(blockStart(2) + 1);
    expect(markedBlocks()).toEqual(["two"]);
  });

  it("marks the new block in the same update as Enter", () => {
    setup();
    editor.commands.setTextSelection(blockStart(1) + 3); // end of "one"
    editor.commands.splitBlock();
    const blocks = Array.from(editor.view.dom.children).map(
      (el) => el.textContent,
    );
    expect(blocks).toEqual(["Title", "one", "", "two", "three"]);
    expect(markedBlocks()).toEqual([""]);
  });

  it("marks only the blocks at the two ends of a selection", () => {
    setup();
    editor.commands.setTextSelection({
      from: blockStart(1),
      to: blockStart(3) + 2,
    });
    expect(markedBlocks()).toEqual(["one", "three"]);
  });

  it("keeps its state when a transaction moves nothing", () => {
    setup();
    editor.commands.setTextSelection(blockStart(2));
    const before = caretBlockPluginKey.getState(editor.state);
    editor.view.dispatch(editor.state.tr.setMeta("noop", true));
    editor.commands.setTextSelection(blockStart(2) + 2); // same block
    expect(caretBlockPluginKey.getState(editor.state)).toBe(before);
  });
});
