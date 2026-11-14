import { afterEach, describe, expect, it } from "bun:test";

import type { Editor, Extension } from "@tiptap/core";
import { CellSelection } from "@tiptap/pm/tables";
import { yUndoPluginKey } from "@tiptap/y-tiptap";
import type * as Y from "yjs";

import { ActionPreview, actionPreviewKey } from "@/extensions/action-preview";
import { getEditorVersionStore } from "@/hooks/use-tiptap-editor";
import {
  type CollabEditorFixture,
  createCollabEditor,
} from "@/tests/helpers/collab-editor";
import {
  createTestEditor,
  DEFAULT_EXTENSIONS,
} from "@/tests/helpers/create-test-editor";

const RED = { "data-text-color": "red", class: "tt-preview" };

const DOC = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Title" }],
    },
    { type: "paragraph", content: [{ type: "text", text: "hello world" }] },
  ],
};

let editor: Editor | undefined;
let collab: CollabEditorFixture | undefined;

afterEach(() => {
  editor?.destroy();
  collab?.destroy();
  editor = undefined;
  collab = undefined;
});

function setup(content: object = DOC): Editor {
  editor = createTestEditor({
    content,
    extensions: [...DEFAULT_EXTENSIONS, ActionPreview] as Extension[],
  });
  return editor;
}

/** "hello" in the paragraph (the title "Title" fills 1..6). */
const HELLO = { from: 8, to: 13 };

const shown = (e: Editor) => actionPreviewKey.getState(e.state)?.find() ?? [];

describe("ActionPreview", () => {
  it("decorates each selection range with the attributes", () => {
    const e = setup();
    e.commands.setTextSelection(HELLO);
    expect(e.commands.setActionPreview(RED)).toBe(true);
    const decorations = shown(e);
    expect(decorations).toHaveLength(1);
    expect(decorations[0].from).toBe(HELLO.from);
    expect(decorations[0].to).toBe(HELLO.to);
    const span = e.view.dom.querySelector('span[data-text-color="red"]');
    expect(span?.textContent).toBe("hello");
    expect(span?.classList.contains("tt-preview")).toBe(true);
  });

  it("clears with null", () => {
    const e = setup();
    e.commands.setTextSelection(HELLO);
    e.commands.setActionPreview(RED);
    e.commands.setActionPreview(null);
    expect(shown(e)).toHaveLength(0);
    expect(e.view.dom.querySelector(".tt-preview")).toBeNull();
  });

  it("does not change the document, the selection or stored marks", () => {
    const e = setup();
    e.commands.setTextSelection(HELLO);
    const before = e.state;
    e.commands.setActionPreview(RED);
    expect(e.state.doc).toBe(before.doc);
    expect(e.state.selection.eq(before.selection)).toBe(true);
    expect(e.state.storedMarks).toBe(before.storedMarks);
  });

  it("clears on a local doc change", () => {
    const e = setup();
    e.commands.setTextSelection(HELLO);
    e.commands.setActionPreview(RED);
    e.view.dispatch(e.state.tr.insertText("!", 20));
    expect(shown(e)).toHaveLength(0);
  });

  it("clears on a selection change", () => {
    const e = setup();
    e.commands.setTextSelection(HELLO);
    e.commands.setActionPreview(RED);
    e.commands.setTextSelection({ from: 8, to: 10 });
    expect(shown(e)).toHaveLength(0);
  });

  it("keeps the preview across a transaction that changes neither", () => {
    const e = setup();
    e.commands.setTextSelection(HELLO);
    e.commands.setActionPreview(RED);
    const set = actionPreviewKey.getState(e.state);
    e.view.dispatch(e.state.tr.setMeta("unrelated", true));
    expect(actionPreviewKey.getState(e.state)).toBe(set);
  });

  it("apply returns the same state object for a typing transaction with nothing shown", () => {
    const e = setup();
    const set = actionPreviewKey.getState(e.state);
    e.view.dispatch(e.state.tr.insertText("x", 20));
    expect(actionPreviewKey.getState(e.state)).toBe(set);
  });

  it("clearing with nothing shown dispatches nothing", () => {
    const e = setup();
    let transactions = 0;
    e.on("transaction", () => {
      transactions += 1;
    });
    e.commands.setActionPreview(null);
    expect(transactions).toBe(0);
  });

  it("does not bump the toolbar version store", () => {
    const e = setup();
    e.commands.setTextSelection(HELLO);
    const store = getEditorVersionStore(e);
    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });
    const version = store.getVersion();
    for (let i = 0; i < 10; i += 1) {
      e.commands.setActionPreview(RED);
      e.commands.setActionPreview(null);
    }
    expect(notified).toBe(0);
    expect(store.getVersion()).toBe(version);
    unsubscribe();
  });

  it("nests inside an existing mark: the preview renders inside the blue span", () => {
    const e = setup({
      type: "doc",
      content: [
        DOC.content[0],
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "hello world",
              marks: [{ type: "textColor", attrs: { color: "blue" } }],
            },
          ],
        },
      ],
    });
    e.commands.setTextSelection(HELLO);
    e.commands.setActionPreview(RED);
    const red = e.view.dom.querySelector('span[data-text-color="red"]');
    expect(red?.parentElement?.closest('[data-text-color="blue"]')).not.toBe(
      null,
    );
    expect(red?.querySelector("[data-text-color]")).toBeNull();
  });

  it("renders a highlight preview as a mark element", () => {
    const e = setup();
    e.commands.setTextSelection(HELLO);
    e.commands.setActionPreview({
      nodeName: "mark",
      "data-highlight": "yellow",
      class: "tt-preview",
    });
    const mark = e.view.dom.querySelector('mark[data-highlight="yellow"]');
    expect(mark?.textContent).toBe("hello");
  });

  it("copy while previewing serializes no preview attributes", () => {
    const e = setup();
    e.commands.setTextSelection(HELLO);
    e.commands.setActionPreview(RED);
    const { dom } = e.view.serializeForClipboard(e.state.selection.content());
    expect(dom.innerHTML).toContain("hello");
    expect(dom.innerHTML).not.toContain("tt-preview");
    expect(dom.innerHTML).not.toContain("data-text-color");
  });

  it("previews each range of a CellSelection", () => {
    const cell = (text: string) => ({
      type: "tableCell",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    });
    const e = setup({
      type: "doc",
      content: [
        DOC.content[0],
        {
          type: "table",
          content: [{ type: "tableRow", content: [cell("one"), cell("two")] }],
        },
      ],
    });
    const cells: number[] = [];
    e.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell") cells.push(pos);
    });
    e.view.dispatch(
      e.state.tr.setSelection(
        CellSelection.create(e.state.doc, cells[0], cells[1]),
      ),
    );
    e.commands.setActionPreview(RED);
    expect(shown(e)).toHaveLength(2);
    const spans = e.view.dom.querySelectorAll('span[data-text-color="red"]');
    expect([...spans].map((span) => span.textContent)).toEqual(["one", "two"]);
  });
});

describe("ActionPreview with collaboration", () => {
  function setupCollab() {
    collab = createCollabEditor({ extensions: [ActionPreview] });
    return collab;
  }

  it("is meta-only: 0 Yjs updates and 0 undo entries for show and clear", () => {
    const { editor: e, client } = setupCollab();
    e.commands.setTextSelection(HELLO);
    const updates: Uint8Array[] = [];
    client.on("update", (update: Uint8Array) => updates.push(update));
    const undoStack = () =>
      yUndoPluginKey.getState(e.state)?.undoManager.undoStack.length ?? 0;
    const before = undoStack();
    for (let i = 0; i < 5; i += 1) {
      e.commands.setActionPreview(RED);
      e.commands.setActionPreview(null);
    }
    expect(updates).toHaveLength(0);
    expect(undoStack()).toBe(before);
  });

  it("redraws on the new selection after a remote doc change", () => {
    const fixture = setupCollab();
    const { editor: e } = fixture;
    // "world": the remote insert lands before it, not at its edge.
    e.commands.setTextSelection({ from: 14, to: 19 });
    e.commands.setActionPreview(RED);
    fixture.remote((frag) => {
      const paragraph = frag.get(1) as Y.XmlElement;
      (paragraph.get(0) as Y.XmlText).insert(0, "remote ");
    });
    // The selection moved with the text; the preview follows it.
    const { from, to } = e.state.selection;
    expect(e.state.doc.textBetween(from, to)).toBe("world");
    expect(from).toBe(21);
    const decorations = shown(e);
    expect(decorations).toHaveLength(1);
    expect([decorations[0].from, decorations[0].to]).toEqual([from, to]);
  });

  it("a local edit after a remote one still clears it", () => {
    const fixture = setupCollab();
    const { editor: e } = fixture;
    e.commands.setTextSelection(HELLO);
    e.commands.setActionPreview(RED);
    fixture.remote((frag) => {
      const paragraph = frag.get(1) as Y.XmlElement;
      (paragraph.get(0) as Y.XmlText).insert(0, "remote ");
    });
    e.view.dispatch(e.state.tr.insertText("!", e.state.doc.content.size - 1));
    expect(shown(e)).toHaveLength(0);
  });
});
