import { afterEach, describe, expect, it } from "bun:test";

import type { Editor, Extension } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

import { EditorActionShortcuts } from "@/extensions/editor-action-shortcuts";
import { onUiIntent } from "@/lib/editor-actions/ui-intents";

import {
  createTestEditor,
  DEFAULT_EXTENSIONS,
} from "../../helpers/create-test-editor";

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function setup(): Editor {
  editor = createTestEditor({
    extensions: [...DEFAULT_EXTENSIONS, EditorActionShortcuts] as Extension[],
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "T" }],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "word",
              marks: [
                { type: "bold" },
                { type: "hyperlink", attrs: { href: "https://example.com" } },
              ],
            },
          ],
        },
      ],
    },
  });
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 4, 8)),
  );
  return editor;
}

const marksOfWord = (target: Editor) =>
  target.state.doc
    .child(1)
    .firstChild?.marks.map((mark) => mark.type.name)
    .sort();

describe("EditorActionShortcuts", () => {
  it("Mod-\\ clears formatting but keeps the link, as one undo step", () => {
    const target = setup();
    expect(target.commands.keyboardShortcut("Mod-\\")).toBe(true);
    expect(marksOfWord(target)).toEqual(["hyperlink"]);
    target.commands.undo();
    expect(marksOfWord(target)).toEqual(["bold", "hyperlink"]);
  });

  it("Mod-\\ changes nothing in a read-only document", () => {
    const target = setup();
    target.setEditable(false);
    target.commands.keyboardShortcut("Mod-\\");
    expect(marksOfWord(target)).toEqual(["bold", "hyperlink"]);
  });

  it("Alt-F10 asks the shell to focus the toolbar", () => {
    const target = setup();
    const seen: string[] = [];
    const off = onUiIntent(target, (intent) => {
      seen.push(intent.type);
      return intent.type === "toolbar.focus";
    });
    expect(target.commands.keyboardShortcut("Alt-F10")).toBe(true);
    expect(seen).toEqual(["toolbar.focus"]);
    off();
  });
});
