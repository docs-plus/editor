import type { Editor } from "@tiptap/core";
import { afterEach, describe, expect, it } from "vitest";

import { changedRanges, rangesTouchNode } from "@/extensions/shared";

import { createTestEditor } from "../../helpers/create-test-editor";

const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

let editor: Editor | undefined;
afterEach(() => editor?.destroy());

function setup() {
  editor = createTestEditor({
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        paragraph("first"),
        paragraph("second"),
      ],
    },
  });
  return editor;
}

describe("changedRanges", () => {
  it("returns the inserted range in final positions", () => {
    const { state } = setup();
    const tr = state.tr.insertText("ab", 9);
    expect(changedRanges([tr])).toEqual([{ from: 9, to: 11 }]);
  });

  it("leaves an empty range where content was deleted", () => {
    const { state } = setup();
    const tr = state.tr.delete(9, 11);
    expect(changedRanges([tr])).toEqual([{ from: 9, to: 9 }]);
  });

  it("maps earlier steps through later ones", () => {
    const { state } = setup();
    // Insert at the end, then at the start: the first range shifts by 3.
    const tr = state.tr.insertText("zz", 20).insertText("abc", 1);
    expect(changedRanges([tr])).toEqual([
      { from: 23, to: 25 },
      { from: 1, to: 4 },
    ]);
  });

  it("covers attribute steps, which have no step map", () => {
    const { state } = setup();
    const tr = state.tr.setNodeAttribute(0, "level", 1);
    expect(changedRanges([tr])).toEqual([{ from: 0, to: 1 }]);
  });

  it("maps ranges across several transactions", () => {
    const { state } = setup();
    const first = state.tr.insertText("x", 9);
    const second = state.apply(first).tr.insertText("yy", 1);
    expect(changedRanges([first, second])).toEqual([
      { from: 11, to: 12 },
      { from: 1, to: 3 },
    ]);
  });
});

describe("rangesTouchNode", () => {
  it("finds the node around or inside a range, without walking text", () => {
    const { state } = setup();
    const isHeading = (node: { type: { name: string } }) =>
      node.type.name === "heading";
    expect(rangesTouchNode(state.doc, [{ from: 3, to: 3 }], isHeading)).toBe(
      true,
    );
    expect(rangesTouchNode(state.doc, [{ from: 9, to: 11 }], isHeading)).toBe(
      false,
    );
  });
});
