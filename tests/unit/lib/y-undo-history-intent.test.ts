import { afterEach, describe, expect, it } from "bun:test";

import type { JSONContent } from "@tiptap/core";
import { UniqueID } from "@tiptap/extension-unique-id";
import { yUndoPluginKey } from "@tiptap/y-tiptap";
import * as Y from "yjs";

import { FastTableOfContents } from "@/extensions/table-of-contents/fast-table-of-contents";

import {
  type CollabEditorFixture,
  createCollabEditor,
} from "../../helpers/collab-editor";

/**
 * `addToHistory: false` keeps a change out of the Yjs undo stack (the seed
 * in `use-document-editor-effects`, a collaborator's change), together with
 * the transactions plugins append to it: UniqueID and the TOC ids for a new
 * heading. y-tiptap 3.3.0 took the flag from the last doc-changing
 * transaction of a dispatch, the appended one, and recorded the whole
 * dispatch (`patches/@tiptap%2Fy-tiptap@3.3.0.patch`).
 */

const CONTENT: JSONContent = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Seeded title" }],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Section" }],
    },
    { type: "paragraph", content: [{ type: "text", text: "Body" }] },
  ],
};

/** The app's heading ids: UniqueID and the outline's `data-toc-id`. */
const HeadingIds = [
  UniqueID.configure({ types: ["heading"] }),
  FastTableOfContents,
];

let f: CollabEditorFixture;

afterEach(() => f.destroy());

function undoDepth(): number {
  const manager = yUndoPluginKey.getState(f.editor.state)?.undoManager as
    | { undoStack: unknown[] }
    | undefined;
  if (!manager) throw new Error("no Yjs undo manager");
  return manager.undoStack.length;
}

const seed = () =>
  f.editor.chain().setMeta("addToHistory", false).setContent(CONTENT).run();

describe("y-tiptap history intent with appended transactions", () => {
  it("heading ids are appended to a new heading", () => {
    f = createCollabEditor({ extensions: HeadingIds });
    seed();
    const title = f.editor.state.doc.firstChild;
    expect(title?.attrs.id).toBeString();
    expect(title?.attrs["data-toc-id"]).toBeString();
  });

  it("keeps an addToHistory: false change out of the undo stack", () => {
    f = createCollabEditor({ extensions: HeadingIds });
    seed();
    expect(undoDepth()).toBe(0);
    expect(f.editor.can().undo()).toBe(false);
  });

  it("an edit right after it is its own undo step", () => {
    f = createCollabEditor({ extensions: HeadingIds });
    seed();
    // Within the 500 ms capture window: it must not join the seed.
    f.editor.chain().setTextSelection({ from: 2, to: 8 }).toggleBold().run();
    expect(undoDepth()).toBe(1);
    f.editor.commands.undo();
    expect(f.editor.getText()).toContain("Seeded title");
    expect(f.editor.isActive("bold")).toBe(false);
  });

  it("still records a user change that gets an appended transaction", () => {
    f = createCollabEditor({ extensions: HeadingIds });
    f.editor.commands.setContent(CONTENT);
    expect(undoDepth()).toBe(1);
    f.editor.commands.undo();
    expect(f.editor.getText()).not.toContain("Seeded title");
    f.editor.commands.redo();
    expect(f.editor.getText()).toContain("Seeded title");
    expect(f.editor.state.doc.firstChild?.attrs.id).toBeString();
  });

  it("ids for a collaborator's new heading are not a local undo step", () => {
    f = createCollabEditor({ extensions: HeadingIds });
    f.remote((frag) => {
      const heading = new Y.XmlElement("heading");
      heading.setAttribute("level", "2");
      heading.insert(0, [new Y.XmlText("From a collaborator")]);
      frag.insert(1, [heading]);
    });
    const added = f.editor.state.doc.child(1);
    expect(added.textContent).toBe("From a collaborator");
    expect(added.attrs["data-toc-id"]).toBeString();
    expect(undoDepth()).toBe(0);
  });
});
