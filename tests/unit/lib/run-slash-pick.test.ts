import { afterEach, describe, expect, it } from "bun:test";

import { HyperMultimediaKit } from "@docs.plus/extension-hypermultimedia";
import type { Editor, Extension } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { TextSelection } from "@tiptap/pm/state";

import {
  getSlashState,
  SlashTrigger,
} from "@/extensions/slash-trigger/slash-trigger";
import { onUiIntent, type UiIntent } from "@/lib/editor-actions/ui-intents";
import { readChoice, TABLE_SIZE_CHOICE } from "@/lib/remembered-choice";
import { runSlashPick } from "@/lib/slash-menu/run-slash-pick";
import type { SlashItem } from "@/lib/slash-menu/slash-items";

import {
  type CollabEditorFixture,
  createCollabEditor,
} from "../../helpers/collab-editor";

let fixture: CollabEditorFixture | undefined;
afterEach(() => {
  fixture?.destroy();
  fixture = undefined;
  localStorage.clear();
});

function setup(): Editor {
  fixture = createCollabEditor({
    extensions: [SlashTrigger, TableKit, HyperMultimediaKit] as Extension[],
  });
  const { editor } = fixture;
  // Caret at the end of "hello world".
  const title = editor.state.doc.firstChild?.nodeSize ?? 0;
  const end = 2 + title + "hello world".length - 1;
  editor.view.dispatch(
    editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)),
  );
  return editor;
}

function type(editor: Editor, text: string): void {
  for (const char of text) {
    editor.view.dispatch(editor.state.tr.insertText(char));
  }
}

/** A new empty paragraph after "hello world", then "/query" typed in it. */
function slashInNewParagraph(editor: Editor, query: string): void {
  editor.commands.splitBlock();
  type(editor, `/${query}`);
  expect(getSlashState(editor).open).toBe(true);
}

const item = (actionId: string, arg?: unknown): SlashItem => ({
  key: actionId,
  actionId,
  arg,
  label: actionId,
  keywords: [],
  section: "Text",
});

/** The top-level block at the caret (the trailing paragraph may follow it). */
const caretBlock = (editor: Editor) => {
  const node = editor.state.selection.$head.node(1);
  return {
    type: node.type.name,
    level: node.attrs.level as number | undefined,
    text: node.textContent,
  };
};

describe("runSlashPick", () => {
  it("one undo step: heading pick, then undo restores '/hea' and the paragraph", () => {
    const editor = setup();
    slashInNewParagraph(editor, "hea");
    expect(runSlashPick(editor, item("style.heading2"))).toBe(true);
    expect(caretBlock(editor)).toEqual({
      type: "heading",
      level: 2,
      text: "",
    });
    expect(getSlashState(editor).open).toBe(false);

    editor.commands.undo();
    expect(caretBlock(editor)).toEqual({
      type: "paragraph",
      level: undefined,
      text: "/hea",
    });
    // The menu does not reopen on undo.
    expect(getSlashState(editor).open).toBe(false);
  });

  it("redo re-applies the pick", () => {
    const editor = setup();
    slashInNewParagraph(editor, "h2");
    runSlashPick(editor, item("style.heading2"));
    editor.commands.undo();
    editor.commands.redo();
    expect(caretBlock(editor)).toEqual({
      type: "heading",
      level: 2,
      text: "",
    });
  });

  it("typing before the '/' stays its own undo step", () => {
    const editor = setup();
    type(editor, " and /quo");
    runSlashPick(editor, item("insert.quote"));
    expect(caretBlock(editor).type).toBe("blockquote");
    editor.commands.undo();
    expect(caretBlock(editor).text).toBe("hello world and /quo");
  });

  it("embed pick deletes the query and asks for the embed step; undo restores the text", () => {
    const editor = setup();
    const intents: UiIntent[] = [];
    const off = onUiIntent(editor, (intent) => {
      intents.push(intent);
      return intent.type === "insert.open";
    });
    slashInNewParagraph(editor, "emb");
    expect(runSlashPick(editor, item("insert.embed"))).toBe(true);
    expect(intents).toEqual([{ type: "insert.open", kind: "embed" }]);
    expect(caretBlock(editor)).toEqual({
      type: "paragraph",
      level: undefined,
      text: "",
    });
    editor.commands.undo();
    expect(caretBlock(editor).text).toBe("/emb");
    off();
  });

  it("a run that returns false puts the text back and leaves the caret after it", () => {
    const editor = setup();
    // Nobody answers the embed intent: the run returns false.
    slashInNewParagraph(editor, "emb");
    const before = editor.state.doc;
    expect(runSlashPick(editor, item("insert.embed"))).toBe(false);
    expect(editor.state.doc.eq(before)).toBe(true);
    const { $head } = editor.state.selection;
    expect($head.parent.textContent).toBe("/emb");
    expect($head.parentOffset).toBe(4);
    expect(getSlashState(editor).open).toBe(false);
  });

  it("refuses when the document became read-only after the menu opened", () => {
    const editor = setup();
    slashInNewParagraph(editor, "h");
    editor.setEditable(false);
    const before = editor.state.doc;
    expect(runSlashPick(editor, item("style.heading2"))).toBe(false);
    expect(editor.state.doc.eq(before)).toBe(true);
  });

  it("refuses an unknown action and an unavailable one, changing nothing", () => {
    const editor = setup();
    slashInNewParagraph(editor, "x");
    const before = editor.state.doc;
    expect(runSlashPick(editor, item("nope.nothing"))).toBe(false);
    expect(editor.state.doc.eq(before)).toBe(true);
  });

  it("table pick inserts at the given size and remembers it", () => {
    const editor = setup();
    slashInNewParagraph(editor, "tab");
    expect(
      runSlashPick(editor, item("insert.table", { rows: 4, cols: 2 })),
    ).toBe(true);
    const sizes: { rows: number; cols: number }[] = [];
    editor.state.doc.forEach((node) => {
      if (node.type.name !== "table") return;
      sizes.push({
        rows: node.childCount,
        cols: node.firstChild?.childCount ?? 0,
      });
    });
    expect(sizes).toEqual([{ rows: 4, cols: 2 }]);
    expect(readChoice(TABLE_SIZE_CHOICE).last).toEqual({ rows: 4, cols: 2 });
    expect(JSON.stringify(editor.getJSON())).not.toContain("/tab");
  });
});
