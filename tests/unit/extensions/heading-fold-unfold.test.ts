import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { Editor, JSONContent } from "@tiptap/core";

import { headingFoldPluginKey } from "@/extensions/heading-fold";
import { createTestEditor } from "@/tests/helpers/create-test-editor";

const heading = (text: string, id: string, level: number): JSONContent => ({
  type: "heading",
  attrs: { level, "data-toc-id": id, id },
  content: [{ type: "text", text }],
});
const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

/** A (h2) ⊃ B (h3) ⊃ C (h4); D (h2) is a sibling of A. */
const DOC: JSONContent = {
  type: "doc",
  content: [
    heading("Title", "title", 1),
    heading("A", "a", 2),
    paragraph("a body"),
    heading("B", "b", 3),
    paragraph("b body"),
    heading("C", "c", 4),
    paragraph("c body"),
    heading("D", "d", 2),
    paragraph("d body"),
  ],
};

const FOLDS_KEY = "tinydocy-folds-test";

let editor: Editor;
let transactions: { docChanged: boolean }[];

const folded = () => [
  ...(headingFoldPluginKey.getState(editor.state)?.foldedIds ?? []),
];
const animating = () =>
  headingFoldPluginKey.getState(editor.state)?.animating.size ?? 0;

function setFolds(ids: string[], persist = true) {
  editor.view.dispatch(
    editor.state.tr.setMeta(headingFoldPluginKey, {
      type: "set",
      ids: new Set(ids),
      persist,
    }),
  );
  transactions = [];
}

beforeEach(() => {
  editor = createTestEditor({ content: DOC });
  transactions = [];
  editor.on("transaction", ({ transaction }) => {
    transactions.push({ docChanged: transaction.docChanged });
  });
});
afterEach(() => editor.destroy());

describe("unfoldAncestors", () => {
  it("unfolds only the folded sections that contain the heading, without animation, and persists", () => {
    setFolds(["a", "b", "d"]);
    expect(editor.commands.unfoldAncestors("c")).toBe(true);
    expect(folded()).toEqual(["d"]);
    expect(animating()).toBe(0);
    expect(JSON.parse(localStorage.getItem(FOLDS_KEY) ?? "[]")).toEqual(["d"]);
  });

  it("is not a doc change", () => {
    setFolds(["a"]);
    editor.commands.unfoldAncestors("b");
    expect(transactions).toHaveLength(1);
    expect(transactions[0].docChanged).toBe(false);
  });

  it("leaves the heading's own fold and unrelated folds alone", () => {
    setFolds(["c", "d"]);
    const before = headingFoldPluginKey.getState(editor.state);
    expect(editor.commands.unfoldAncestors("c")).toBe(true);
    expect(headingFoldPluginKey.getState(editor.state)).toBe(before);
    expect(folded().sort()).toEqual(["c", "d"]);
  });

  it("keeps temporary (filter) folds temporary", () => {
    localStorage.removeItem(FOLDS_KEY);
    setFolds(["a", "d"], false);
    editor.commands.unfoldAncestors("b");
    expect(folded()).toEqual(["d"]);
    expect(localStorage.getItem(FOLDS_KEY)).toBeNull();
  });

  it("returns false for a heading that is gone", () => {
    setFolds(["a"]);
    expect(editor.commands.unfoldAncestors("missing")).toBe(false);
    expect(folded()).toEqual(["a"]);
  });
});
