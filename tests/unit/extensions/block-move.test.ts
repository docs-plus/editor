import { afterEach, describe, expect, it } from "bun:test";

import type { Editor, JSONContent } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { yUndoPluginKey } from "@tiptap/y-tiptap";

import {
  BLOCK_MOVE_REASONS,
  canDuplicateBlock,
  canMoveBlock,
  duplicateBlock,
  moveBlock,
} from "@/extensions/block-move";
import {
  type CollabEditorFixture,
  createCollabEditor,
} from "@/tests/helpers/collab-editor";
import { createTestEditor } from "@/tests/helpers/create-test-editor";

const text = (value: string) => [{ type: "text", text: value }];
const p = (value: string): JSONContent => ({
  type: "paragraph",
  content: text(value),
});
const h = (level: number, value: string, id?: string): JSONContent => ({
  type: "heading",
  attrs: id ? { level, "data-toc-id": id, id } : { level },
  content: text(value),
});
const doc = (...blocks: JSONContent[]): JSONContent => ({
  type: "doc",
  content: [h(1, "Title"), ...blocks],
});

/** Top-level blocks as their text, the trailing empty paragraph dropped. */
function blocks(node: PMNode): string[] {
  const out: string[] = [];
  node.forEach((child) => {
    out.push(child.textContent);
  });
  while (out.length > 1 && out[out.length - 1] === "") out.pop();
  return out;
}

/** Puts the caret inside the first text node containing `value`. */
function caretIn(editor: Editor, value: string, offset = 1): void {
  let pos = -1;
  editor.state.doc.descendants((node, at) => {
    if (pos >= 0 || !node.isText) return pos < 0;
    const index = node.text?.indexOf(value) ?? -1;
    if (index >= 0) pos = at + index + offset;
    return false;
  });
  if (pos < 0) throw new Error(`No text "${value}"`);
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)),
  );
}

function selectionText(editor: Editor): string {
  const { $head } = editor.state.selection;
  return $head.parent.textContent;
}

let fixtures: CollabEditorFixture[] = [];
let plain: Editor | null = null;

/** A collaborative editor holding `content`, with an empty undo stack. */
function collab(content: JSONContent, server?: CollabEditorFixture["server"]) {
  const fixture = createCollabEditor(server ? { server } : {});
  fixtures.push(fixture);
  if (!server) fixture.editor.commands.setContent(content);
  const undoManager = yUndoPluginKey.getState(fixture.editor.state)
    ?.undoManager as { clear(): void } | undefined;
  undoManager?.clear();
  return fixture;
}

afterEach(() => {
  for (const fixture of fixtures) fixture.destroy();
  fixtures = [];
  plain?.destroy();
  plain = null;
});

describe("moveBlock", () => {
  it("moves the caret's block up and down, keeping the caret in it", () => {
    const { editor } = collab(doc(p("A"), p("B"), p("C")));
    caretIn(editor, "B");

    expect(moveBlock(editor, "up")).toBe(true);
    expect(blocks(editor.state.doc)).toEqual(["Title", "B", "A", "C"]);
    expect(selectionText(editor)).toBe("B");

    expect(moveBlock(editor, "down")).toBe(true);
    expect(moveBlock(editor, "down")).toBe(true);
    expect(blocks(editor.state.doc)).toEqual(["Title", "A", "C", "B"]);
    expect(selectionText(editor)).toBe("B");
  });

  it("keeps the caret's offset inside the moved block", () => {
    const { editor } = collab(doc(p("A"), p("Bravo")));
    caretIn(editor, "Bravo", 3);
    const before = editor.state.selection.$head.parentOffset;
    moveBlock(editor, "up");
    expect(editor.state.selection.$head.parentOffset).toBe(before);
  });

  it("moves every block a selection touches, as one unit", () => {
    const { editor } = collab(doc(p("A"), p("B"), p("C"), p("D")));
    caretIn(editor, "B");
    const from = editor.state.selection.from;
    caretIn(editor, "C");
    const to = editor.state.selection.from;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, from, to),
      ),
    );

    expect(moveBlock(editor, "down")).toBe(true);
    expect(blocks(editor.state.doc)).toEqual(["Title", "A", "D", "B", "C"]);
    expect(
      editor.state.doc.textBetween(
        editor.state.selection.from,
        editor.state.selection.to,
        "|",
      ),
    ).toBe("|C");
  });

  it("leaves a block out when the selection only reaches its start", () => {
    const { editor } = collab(doc(p("A"), p("B"), p("C")));
    caretIn(editor, "A", 0);
    const from = editor.state.selection.from;
    caretIn(editor, "B", 0);
    const to = editor.state.selection.from;
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, from, to),
      ),
    );
    expect(moveBlock(editor, "down")).toBe(true);
    expect(blocks(editor.state.doc)).toEqual(["Title", "B", "A", "C"]);
  });

  it("moves a selected node (a horizontal rule)", () => {
    const { editor } = collab(doc(p("A"), { type: "horizontalRule" }, p("C")));
    let rulePos = -1;
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === "horizontalRule") rulePos = offset;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(
        NodeSelection.create(editor.state.doc, rulePos),
      ),
    );
    expect(moveBlock(editor, "up")).toBe(true);
    expect(editor.state.doc.child(1).type.name).toBe("horizontalRule");
    expect(editor.state.selection).toBeInstanceOf(NodeSelection);
    expect((editor.state.selection as NodeSelection).node.type.name).toBe(
      "horizontalRule",
    );
  });

  it("moves a whole list from inside one of its items", () => {
    const list: JSONContent = {
      type: "bulletList",
      content: [
        { type: "listItem", content: [p("one")] },
        { type: "listItem", content: [p("two")] },
      ],
    };
    const { editor } = collab(doc(p("A"), list));
    caretIn(editor, "two");
    expect(moveBlock(editor, "up")).toBe(true);
    expect(editor.state.doc.child(1).type.name).toBe("bulletList");
    expect(selectionText(editor)).toBe("two");
  });

  describe("title first (heading block*)", () => {
    it("never moves the title", () => {
      const { editor } = collab(doc(p("A"), p("B")));
      caretIn(editor, "Title");
      const before = editor.state.doc;
      expect(canMoveBlock(editor.state, "down")).toEqual({
        reason: BLOCK_MOVE_REASONS.title,
      });
      expect(moveBlock(editor, "down")).toBe(false);
      expect(moveBlock(editor, "up")).toBe(false);
      expect(editor.state.doc).toBe(before);
    });

    it("never moves a block above the title", () => {
      const { editor } = collab(doc(p("A"), p("B")));
      caretIn(editor, "A");
      expect(canMoveBlock(editor.state, "up")).toEqual({
        reason: BLOCK_MOVE_REASONS.first,
      });
      expect(moveBlock(editor, "up")).toBe(false);
      expect(blocks(editor.state.doc)).toEqual(["Title", "A", "B"]);
    });

    it("refuses a selection that includes the title (select all)", () => {
      const { editor } = collab(doc(p("A"), p("B")));
      editor.commands.selectAll();
      expect(moveBlock(editor, "down")).toBe(false);
      expect(blocks(editor.state.doc)).toEqual(["Title", "A", "B"]);
    });

    it("refuses moving the last block down", () => {
      const plainEditor = createTestEditor({ content: doc(p("A"), p("B")) });
      plain = plainEditor;
      caretIn(plainEditor, "B");
      // The trailing node may follow; move until the end, then refuse.
      while (moveBlock(plainEditor, "down")) {
        /* to the end */
      }
      expect(canMoveBlock(plainEditor.state, "down")).toEqual({
        reason: BLOCK_MOVE_REASONS.last,
      });
      expect(plainEditor.state.doc.child(0).textContent).toBe("Title");
    });

    it("keeps a heading moved next to the title a body heading", () => {
      const { editor } = collab(doc(p("A"), h(2, "Sub")));
      caretIn(editor, "Sub");
      expect(moveBlock(editor, "up")).toBe(true);
      expect(editor.state.doc.child(0).textContent).toBe("Title");
      expect(editor.state.doc.child(0).attrs.level).toBe(1);
      expect(editor.state.doc.child(1).attrs.level).toBe(2);
    });
  });

  describe("undo", () => {
    it("is one undo step", () => {
      const { editor } = collab(doc(p("A"), p("B"), p("C")));
      caretIn(editor, "C");
      moveBlock(editor, "up");
      editor.commands.undo();
      expect(blocks(editor.state.doc)).toEqual(["Title", "A", "B", "C"]);
    });

    it("takes two undos for two quick moves", () => {
      const { editor } = collab(doc(p("A"), p("B"), p("C")));
      caretIn(editor, "C");
      moveBlock(editor, "up");
      moveBlock(editor, "up");
      expect(blocks(editor.state.doc)).toEqual(["Title", "C", "A", "B"]);
      editor.commands.undo();
      expect(blocks(editor.state.doc)).toEqual(["Title", "A", "C", "B"]);
      editor.commands.undo();
      expect(blocks(editor.state.doc)).toEqual(["Title", "A", "B", "C"]);
    });

    it("keeps typing right before it a separate step", () => {
      const { editor } = collab(doc(p("A"), p("B")));
      caretIn(editor, "B", 1);
      editor.commands.insertContent("!");
      moveBlock(editor, "up");
      editor.commands.undo();
      expect(blocks(editor.state.doc)).toEqual(["Title", "A", "B!"]);
    });
  });

  describe("read-only", () => {
    it("changes nothing in a read-only editor", () => {
      const { editor } = collab(doc(p("A"), p("B")));
      caretIn(editor, "B");
      editor.setEditable(false);
      expect(moveBlock(editor, "up")).toBe(false);
      expect(duplicateBlock(editor)).toBe(false);
      expect(blocks(editor.state.doc)).toEqual(["Title", "A", "B"]);
    });
  });

  describe("folded sections", () => {
    const folded = new Set(["s1"]);
    const content = doc(
      h(2, "Folded", "s1"),
      p("hidden"),
      h(2, "Open", "s2"),
      p("X"),
    );

    it("moves down past a folded section as one unit", () => {
      plain = createTestEditor({
        content: doc(
          p("X"),
          h(2, "Folded", "s1"),
          p("hidden"),
          h(2, "Open", "s2"),
        ),
      });
      caretIn(plain, "X");
      expect(moveBlock(plain, "down", { foldedIds: folded })).toBe(true);
      expect(blocks(plain.state.doc)).toEqual([
        "Title",
        "Folded",
        "hidden",
        "X",
        "Open",
      ]);
    });

    it("moves up past a folded section as one unit", () => {
      plain = createTestEditor({ content });
      caretIn(plain, "Open");
      expect(moveBlock(plain, "up", { foldedIds: folded })).toBe(true);
      expect(blocks(plain.state.doc)).toEqual([
        "Title",
        "Open",
        "Folded",
        "hidden",
        "X",
      ]);
    });

    it("carries a folded heading's hidden body with it", () => {
      plain = createTestEditor({ content });
      caretIn(plain, "Folded");
      expect(moveBlock(plain, "down", { foldedIds: folded })).toBe(true);
      expect(blocks(plain.state.doc)).toEqual([
        "Title",
        "Open",
        "Folded",
        "hidden",
        "X",
      ]);
    });

    it("moves one block at a time without fold state", () => {
      plain = createTestEditor({ content });
      caretIn(plain, "Open");
      expect(moveBlock(plain, "up")).toBe(true);
      expect(blocks(plain.state.doc)).toEqual([
        "Title",
        "Folded",
        "Open",
        "hidden",
        "X",
      ]);
    });
  });

  describe("concurrent remote edits", () => {
    it("converges when a collaborator types in another block meanwhile", () => {
      const a = collab(doc(p("A"), p("B"), p("C")));
      const b = collab(doc(), a.server);
      a.pause();
      b.pause();
      caretIn(a.editor, "C");
      moveBlock(a.editor, "up");
      caretIn(b.editor, "A", 1);
      b.editor.commands.insertContent("a");
      a.resume();
      b.resume();

      const left = a.editor.state.doc;
      const right = b.editor.state.doc;
      expect(left.toJSON()).toEqual(right.toJSON());
      expect(blocks(left)).toEqual(["Title", "Aa", "C", "B"]);
      expect(left.child(0).type.name).toBe("heading");
      expect(left.child(0).attrs.level).toBe(1);
    });

    /**
     * Yjs 13 has no move, so one side of a move is deleted and re-created,
     * and a collaborator's typing in that side meanwhile is lost (as with
     * section moves). The smaller side is the one re-created; on a tie,
     * the passed block, so the moved blocks keep their edits.
     */
    function concurrent(
      content: JSONContent,
      move: { block: string; direction: "up" | "down" },
      typeIn: string,
    ) {
      const a = collab(content);
      const b = collab(doc(), a.server);
      a.pause();
      b.pause();
      caretIn(a.editor, move.block);
      expect(moveBlock(a.editor, move.direction)).toBe(true);
      caretIn(b.editor, typeIn, 1);
      b.editor.commands.insertContent("+");
      a.resume();
      b.resume();
      const left = a.editor.state.doc;
      expect(left.toJSON()).toEqual(b.editor.state.doc.toJSON());
      expect(left.child(0).textContent).toBe("Title");
      return blocks(left);
    }

    it("keeps typing in the moved block on a tie, moving up", () => {
      expect(
        concurrent(
          doc(p("A"), p("B"), p("C")),
          { block: "C", direction: "up" },
          "C",
        ),
      ).toEqual(["Title", "A", "C+", "B"]);
    });

    it("keeps typing in the moved block on a tie, moving down", () => {
      expect(
        concurrent(
          doc(p("A"), p("B"), p("C")),
          { block: "B", direction: "down" },
          "B",
        ),
      ).toEqual(["Title", "A", "C", "B+"]);
    });

    it("keeps typing in the passed block when it is the larger side", () => {
      expect(
        concurrent(
          doc(p("A"), p("Longer"), p("C")),
          { block: "C", direction: "up" },
          "Longer",
        ),
      ).toEqual(["Title", "A", "C", "L+onger"]);
    });

    it("keeps typing in the moved blocks when they are the larger side", () => {
      expect(
        concurrent(
          doc(p("A"), p("Longer"), p("C")),
          { block: "Longer", direction: "down" },
          "Longer",
        ),
      ).toEqual(["Title", "A", "C", "L+onger"]);
    });

    it("re-reads the live document: a move after a remote delete moves what is there", () => {
      const a = collab(doc(p("A"), p("B"), p("C")));
      a.remote((fragment) => {
        fragment.delete(1, 1); // A collaborator deletes "A".
      });
      caretIn(a.editor, "B");
      expect(canMoveBlock(a.editor.state, "up")).toEqual({
        reason: BLOCK_MOVE_REASONS.first,
      });
      caretIn(a.editor, "C");
      expect(moveBlock(a.editor, "up")).toBe(true);
      expect(blocks(a.editor.state.doc)).toEqual(["Title", "C", "B"]);
    });
  });
});

describe("duplicateBlock", () => {
  it("copies the caret's block below it and moves the caret into the copy", () => {
    const { editor } = collab(doc(p("A"), p("B")));
    caretIn(editor, "A", 1);
    expect(duplicateBlock(editor)).toBe(true);
    expect(blocks(editor.state.doc)).toEqual(["Title", "A", "A", "B"]);
    expect(editor.state.selection.$head.index(0)).toBe(2);
  });

  it("is one undo step", () => {
    const { editor } = collab(doc(p("A"), p("B")));
    caretIn(editor, "B");
    duplicateBlock(editor);
    duplicateBlock(editor);
    editor.commands.undo();
    expect(blocks(editor.state.doc)).toEqual(["Title", "A", "B", "B"]);
    editor.commands.undo();
    expect(blocks(editor.state.doc)).toEqual(["Title", "A", "B"]);
  });

  it("never duplicates the title", () => {
    const { editor } = collab(doc(p("A")));
    caretIn(editor, "Title");
    expect(canDuplicateBlock(editor.state)).toEqual({
      reason: BLOCK_MOVE_REASONS.titleDuplicate,
    });
    expect(duplicateBlock(editor)).toBe(false);
    expect(blocks(editor.state.doc)).toEqual(["Title", "A"]);
  });

  it("gives a duplicated heading its own id", () => {
    plain = createTestEditor({ content: doc(h(2, "Sub", "sub-1"), p("A")) });
    caretIn(plain, "Sub");
    expect(duplicateBlock(plain)).toBe(true);
    const original = plain.state.doc.child(1);
    const copy = plain.state.doc.child(2);
    expect(copy.textContent).toBe("Sub");
    expect(original.attrs["data-toc-id"]).toBe("sub-1");
    expect(copy.attrs["data-toc-id"]).not.toBe("sub-1");
    expect(copy.attrs.id).not.toBe(original.attrs.id);
  });

  it("copies a folded section whole", () => {
    plain = createTestEditor({
      content: doc(h(2, "Folded", "s1"), p("hidden"), p("after")),
    });
    caretIn(plain, "Folded");
    // "after" belongs to the folded section too (no heading ends it).
    expect(duplicateBlock(plain, { foldedIds: new Set(["s1"]) })).toBe(true);
    expect(blocks(plain.state.doc)).toEqual([
      "Title",
      "Folded",
      "hidden",
      "after",
      "Folded",
      "hidden",
      "after",
    ]);
  });
});
