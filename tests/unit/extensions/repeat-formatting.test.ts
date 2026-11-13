import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { Editor } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { AllSelection, NodeSelection, TextSelection } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import { yUndoPluginKey } from "@tiptap/y-tiptap";
import type * as Y from "yjs";

import { RepeatFormatting } from "@/extensions/repeat-formatting";
import {
  REPEAT_REASONS,
  repeatDisabledReason,
} from "@/extensions/repeat-formatting/apply-bundle";
import {
  getRememberedBundle,
  rememberBundle,
  resetBundleMemoryForTests,
} from "@/extensions/repeat-formatting/bundle-memory";
import { runAction } from "@/lib/editor-actions/registry";
import { repeatApplyAction } from "@/lib/editor-actions/v11-actions";

import {
  type CollabEditorFixture,
  createCollabEditor,
} from "../../helpers/collab-editor";
import { FontSizeStandIn, TextColorStandIn } from "./text-style-stand-ins";

let f: CollabEditorFixture;
let editor: Editor;

beforeEach(() => {
  resetBundleMemoryForTests();
  f = createCollabEditor({
    extensions: [TextColorStandIn, FontSizeStandIn, RepeatFormatting],
  });
  editor = f.editor;
});

afterEach(() => {
  f.destroy();
  resetBundleMemoryForTests();
});

/** Selects the first occurrence of `text`. */
function sel(text: string): void {
  let found: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found || !node.isText) return !found;
    const index = node.text?.indexOf(text) ?? -1;
    if (index >= 0)
      found = { from: pos + index, to: pos + index + text.length };
    return false;
  });
  if (!found) throw new Error(`text not found: ${text}`);
  const { from, to } = found as { from: number; to: number };
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, from, to),
    ),
  );
}

function marksOf(text: string): string[] {
  let marks: string[] | null = null;
  editor.state.doc.descendants((node) => {
    if (marks || !node.isText) return !marks;
    if (node.text?.includes(text)) {
      marks = node.marks
        .map((m) =>
          m.attrs.color || m.attrs.size
            ? `${m.type.name}:${m.attrs.color ?? m.attrs.size}`
            : m.type.name,
        )
        .sort();
    }
    return false;
  });
  return marks ?? [];
}

const setRed = () => editor.commands.setMark("textColor", { color: "red" });

/** Waits out the Yjs undo capture window would be too slow; force a step. */
const undo = () => editor.commands.undo();
const redo = () => editor.commands.redo();

describe("RepeatFormatting: recording", () => {
  it("has an undo manager in the fixture", () => {
    expect(yUndoPluginKey.getState(editor.state)?.undoManager).toBeDefined();
  });

  it("formatting on one selection opens and extends the bundle", () => {
    sel("hello");
    editor.commands.toggleBold();
    setRed();
    expect(getRememberedBundle()).toEqual({ bold: true, textColor: "red" });
  });

  it("a new selection replaces the bundle", () => {
    sel("hello");
    editor.commands.toggleBold();
    sel("world");
    editor.commands.toggleItalic();
    expect(getRememberedBundle()).toEqual({ italic: true });
  });

  it("a remote insert before the range keeps the session", () => {
    sel("hello");
    editor.commands.toggleBold();
    const before = getRememberedBundle();
    f.remote((frag) => {
      const paragraph = frag.get(1) as Y.XmlElement;
      (paragraph.get(0) as Y.XmlText).insert(0, "XX");
    });
    expect(editor.state.doc.textContent).toContain("XXhello");
    expect(getRememberedBundle()).toEqual(before);
    setRed();
    expect(getRememberedBundle()).toEqual({ bold: true, textColor: "red" });
  });

  it("undo closes the session", () => {
    sel("hello");
    editor.commands.toggleBold();
    undo();
    sel("hello");
    editor.commands.toggleItalic();
    expect(getRememberedBundle()).toEqual({ italic: true });
  });

  it("redo closes the session", () => {
    sel("hello");
    editor.commands.toggleBold();
    undo();
    redo();
    sel("hello");
    editor.commands.toggleItalic();
    expect(getRememberedBundle()).toEqual({ italic: true });
  });

  it("never records a remote mark change", () => {
    rememberBundle({ underline: true });
    f.remote((frag) => {
      const paragraph = frag.get(1) as Y.XmlElement;
      (paragraph.get(0) as Y.XmlText).format(0, 5, { bold: {} });
    });
    expect(marksOf("hello")).toContain("bold");
    expect(getRememberedBundle()).toEqual({ underline: true });
  });
});

describe("RepeatFormatting: applying", () => {
  it("sets, never toggles", () => {
    sel("hello");
    editor.commands.toggleBold();
    rememberBundle({ bold: true, textColor: "red" });
    editor.commands.setTextSelection({ from: 8, to: 19 });
    expect(editor.commands.repeatFormatting()).toBe(true);
    expect(marksOf("hello")).toEqual(["bold", "textColor:red"]);
    expect(marksOf("world")).toEqual(["bold", "textColor:red"]);
    const json = JSON.stringify(editor.getJSON());
    editor.commands.repeatFormatting();
    expect(JSON.stringify(editor.getJSON())).toBe(json);
  });

  it("clears with false / null", () => {
    sel("hello");
    editor.commands.toggleBold();
    setRed();
    rememberBundle({ bold: false, textColor: null });
    sel("hello");
    editor.commands.repeatFormatting();
    expect(marksOf("hello")).toEqual([]);
  });

  it("is one undo step with a format right before it", () => {
    sel("hello");
    editor.commands.toggleBold();
    rememberBundle({ italic: true, textColor: "red" });
    sel("world");
    editor.commands.repeatFormatting();
    undo();
    expect(marksOf("world")).toEqual([]);
    expect(marksOf("hello")).toEqual(["bold"]);
  });

  it("is one undo step with typing right after it", () => {
    rememberBundle({ bold: true });
    sel("world");
    editor.commands.repeatFormatting();
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, "!");
    expect(editor.state.doc.textContent).toContain("world!");
    undo();
    expect(editor.state.doc.textContent).not.toContain("!");
    expect(marksOf("world")).toEqual(["bold"]);
    undo();
    expect(marksOf("world")).toEqual([]);
  });

  it("formats a mixed selection: title without size, code untouched, cells", () => {
    f.destroy();
    f = createCollabEditor({
      extensions: [
        TextColorStandIn,
        FontSizeStandIn,
        RepeatFormatting,
        TableKit,
      ],
    });
    editor = f.editor;
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "body" }] },
        { type: "codeBlock", content: [{ type: "text", text: "code" }] },
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "c1" }],
                    },
                  ],
                },
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "c2" }],
                    },
                  ],
                },
              ],
            },
          ],
        },
        { type: "paragraph" },
      ],
    });
    rememberBundle({ bold: true, fontSize: "lg" });
    editor.view.dispatch(
      editor.state.tr.setSelection(new AllSelection(editor.state.doc)),
    );
    expect(editor.commands.repeatFormatting()).toBe(true);
    expect(marksOf("Title")).toEqual(["bold"]);
    expect(marksOf("body")).toEqual(["bold", "fontSize:lg"]);
    expect(marksOf("code")).toEqual([]);

    rememberBundle({ italic: true });
    let cells: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell") cells.push(pos);
      return true;
    });
    editor.view.dispatch(
      editor.state.tr.setSelection(
        CellSelection.create(editor.state.doc, cells[0], cells[1]),
      ),
    );
    expect(editor.commands.repeatFormatting()).toBe(true);
    expect(marksOf("c1")).toContain("italic");
    expect(marksOf("c2")).toContain("italic");
    undo();
    expect(marksOf("c1")).not.toContain("italic");
    expect(marksOf("c1")).toContain("bold");
    cells = [];
  });

  it("gives the exact reasons", () => {
    expect(repeatDisabledReason(editor.state, null)).toBe(
      REPEAT_REASONS.noBundle,
    );
    expect(repeatDisabledReason(editor.state, {})).toBe(
      REPEAT_REASONS.noBundle,
    );
    editor.commands.setTextSelection(9);
    expect(repeatDisabledReason(editor.state, { bold: true })).toBe(
      REPEAT_REASONS.noText,
    );
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, 7)),
    );
    expect(repeatDisabledReason(editor.state, { bold: true })).toBe(
      REPEAT_REASONS.noText,
    );
    sel("Title");
    expect(repeatDisabledReason(editor.state, { fontSize: "lg" })).toBe(
      REPEAT_REASONS.heading,
    );
    expect(
      repeatDisabledReason(editor.state, { bold: true, fontSize: "lg" }),
    ).toBeNull();
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "T" }],
        },
        { type: "codeBlock", content: [{ type: "text", text: "code" }] },
      ],
    });
    sel("code");
    expect(repeatDisabledReason(editor.state, { bold: true })).toBe(
      REPEAT_REASONS.code,
    );
    for (const reason of Object.values(REPEAT_REASONS))
      expect(reason.endsWith(".")).toBe(true);
  });

  it("copy formatting remembers the full read, then clears with it", () => {
    sel("hello");
    editor.commands.toggleBold();
    setRed();
    sel("hello");
    editor.commands.copyFormatting();
    expect(getRememberedBundle()).toEqual({
      bold: true,
      italic: false,
      underline: false,
      strike: false,
      textColor: "red",
      highlight: null,
      fontSize: null,
    });
    sel("world");
    editor.commands.copyFormatting();
    sel("hello");
    editor.commands.repeatFormatting();
    expect(marksOf("hello")).toEqual([]);
  });

  it("refuses in a read-only editor, and the registry gate returns false", () => {
    rememberBundle({ bold: true });
    sel("world");
    editor.setEditable(false);
    expect(runAction(editor, repeatApplyAction)).toBe(false);
    expect(editor.commands.repeatFormatting()).toBe(false);
    expect(marksOf("world")).toEqual([]);
  });

  it("adds no undo-manager listener (nothing to leak across tab switches)", () => {
    const manager = yUndoPluginKey.getState(editor.state)
      ?.undoManager as unknown as {
      _observers: Map<string, Set<unknown>>;
    };
    expect(manager._observers.get("stack-item-popped")?.size ?? 0).toBe(0);
    editor.destroy();
  });
});
