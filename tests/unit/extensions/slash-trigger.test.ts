import { afterEach, describe, expect, it } from "bun:test";

import type { Editor, Extension, JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

import {
  closeSlash,
  getSlashState,
  SLASH_MAX_QUERY,
  SlashTrigger,
} from "@/extensions/slash-trigger/slash-trigger";
import { getEditorVersionStore } from "@/hooks/use-tiptap-editor";

import {
  type CollabEditorFixture,
  createCollabEditor,
} from "../../helpers/collab-editor";
import {
  createTestEditor,
  DEFAULT_EXTENSIONS,
} from "../../helpers/create-test-editor";

let editor: Editor | undefined;
let fixtures: CollabEditorFixture[] = [];
afterEach(() => {
  editor?.destroy();
  editor = undefined;
  for (const fixture of fixtures) fixture.destroy();
  fixtures = [];
});

const doc = (...blocks: JSONContent[]): JSONContent => ({
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Title" }],
    },
    ...blocks,
  ],
});

const para = (text?: string, marks?: JSONContent["marks"]): JSONContent => ({
  type: "paragraph",
  content: text ? [{ type: "text", text, marks }] : [],
});

function setup(...blocks: JSONContent[]): Editor {
  editor = createTestEditor({
    extensions: [...DEFAULT_EXTENSIONS, SlashTrigger] as Extension[],
    content: doc(...(blocks.length ? blocks : [para()])),
  });
  return editor;
}

/** Puts the caret at the end of the first block whose text is `text`. */
function caretAfter(ed: Editor, text: string): void {
  let pos = -1;
  ed.state.doc.descendants((node, offset) => {
    if (pos >= 0) return false;
    if (node.isTextblock && node.textContent === text) {
      pos = offset + 1 + node.content.size;
      return false;
    }
    return true;
  });
  if (pos < 0) throw new Error(`no block "${text}"`);
  ed.view.dispatch(
    ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)),
  );
}

/** Types like ProseMirror's text input: one `insertText` per character. */
function type(ed: Editor, text: string): void {
  for (const char of text) ed.view.dispatch(ed.state.tr.insertText(char));
}

const open = (ed: Editor) => getSlashState(ed).open;
const query = (ed: Editor) => {
  const state = getSlashState(ed);
  return state.open ? state.query : null;
};

describe("SlashTrigger: opening", () => {
  it("opens on '/' at the start of a paragraph and after a space", () => {
    const ed = setup(para(), para("word"));
    caretAfter(ed, "");
    type(ed, "/");
    expect(open(ed)).toBe(true);
    expect(query(ed)).toBe("");

    closeSlash(ed);
    caretAfter(ed, "word");
    type(ed, " /");
    expect(open(ed)).toBe(true);
  });

  it("opens in a list item, a quote and a table cell paragraph", () => {
    const ed = setup(
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [para("item")] }],
      },
      { type: "blockquote", content: [para("quoted")] },
    );
    caretAfter(ed, "item");
    type(ed, " /");
    expect(open(ed)).toBe(true);
    closeSlash(ed);
    caretAfter(ed, "quoted");
    type(ed, " /");
    expect(open(ed)).toBe(true);
  });

  it("never opens mid-word ('and/or'), in the title, a heading, a code block, inline code or read-only", () => {
    const ed = setup(
      para("and"),
      { type: "heading", attrs: { level: 2 }, content: [] },
      { type: "codeBlock", content: [{ type: "text", text: "x " }] },
      para("code ", [{ type: "inlineCode" }]),
      para("ro"),
    );
    caretAfter(ed, "and");
    type(ed, "/");
    expect(open(ed)).toBe(false);

    caretAfter(ed, "Title");
    type(ed, " /");
    expect(open(ed)).toBe(false);

    caretAfter(ed, "");
    type(ed, "/");
    expect(open(ed)).toBe(false);

    caretAfter(ed, "x ");
    type(ed, "/");
    expect(open(ed)).toBe(false);

    caretAfter(ed, "code ");
    // Typing on at the end of inline code, with its mark stored.
    ed.view.dispatch(
      ed.state.tr
        .setStoredMarks([ed.schema.marks.inlineCode.create()])
        .insertText("/"),
    );
    expect(open(ed)).toBe(false);

    caretAfter(ed, "ro");
    ed.setEditable(false);
    type(ed, " /");
    expect(open(ed)).toBe(false);
  });

  it("never opens on a full-width '／', a pasted '/abc' or a pasted '/'", () => {
    const ed = setup(para());
    caretAfter(ed, "");
    type(ed, "／");
    expect(open(ed)).toBe(false);
    ed.view.dispatch(ed.state.tr.insertText(" /abc"));
    expect(open(ed)).toBe(false);
    ed.view.dispatch(ed.state.tr.insertText(" "));
    ed.view.dispatch(ed.state.tr.insertText("/").setMeta("uiEvent", "paste"));
    expect(open(ed)).toBe(false);
  });

  it("never opens on a '/' that replaces a selection", () => {
    const ed = setup(para("abc"));
    caretAfter(ed, "abc");
    const end = ed.state.selection.from;
    ed.view.dispatch(
      ed.state.tr.setSelection(
        TextSelection.create(ed.state.doc, end - 3, end),
      ),
    );
    type(ed, "/");
    expect(open(ed)).toBe(false);
  });
});

describe("SlashTrigger: tracking and closing", () => {
  it("tracks the query as it is typed", () => {
    const ed = setup(para());
    caretAfter(ed, "");
    type(ed, "/hea");
    expect(query(ed)).toBe("hea");
    ed.view.dispatch(
      ed.state.tr.delete(ed.state.selection.from - 1, ed.state.selection.from),
    );
    expect(query(ed)).toBe("he");
  });

  it("closes when the '/' is deleted", () => {
    const ed = setup(para());
    caretAfter(ed, "");
    type(ed, "/");
    const { from } = ed.state.selection;
    ed.view.dispatch(ed.state.tr.delete(from - 1, from));
    expect(open(ed)).toBe(false);
  });

  it("closes on a '/' or two spaces in the query, and past the length cap", () => {
    const ed = setup(para());
    caretAfter(ed, "");
    type(ed, "/usr/");
    expect(open(ed)).toBe(false);

    type(ed, " /a  ");
    expect(open(ed)).toBe(false);

    type(ed, " /");
    type(ed, "a".repeat(SLASH_MAX_QUERY));
    expect(open(ed)).toBe(true);
    type(ed, "a");
    expect(open(ed)).toBe(false);
  });

  it("closes on a space right after the '/' ('1 / 2')", () => {
    const ed = setup(para());
    caretAfter(ed, "");
    type(ed, "1 /");
    expect(open(ed)).toBe(true);
    type(ed, " ");
    expect(open(ed)).toBe(false);
  });

  it("keeps a query with one space open ('/heading 2')", () => {
    const ed = setup(para());
    caretAfter(ed, "");
    type(ed, "/heading 2");
    expect(query(ed)).toBe("heading 2");
  });

  it("closes when the caret leaves the query or a range is selected", () => {
    const ed = setup(para(), para("other"));
    caretAfter(ed, "");
    type(ed, "/h");
    caretAfter(ed, "other");
    expect(open(ed)).toBe(false);

    caretAfter(ed, "other");
    type(ed, " /h");
    const { from } = ed.state.selection;
    // Caret before the "/".
    ed.view.dispatch(
      ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from - 2)),
    );
    expect(open(ed)).toBe(false);

    ed.view.dispatch(
      ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from)),
    );
    type(ed, " /h");
    const head = ed.state.selection.from;
    ed.view.dispatch(
      ed.state.tr.setSelection(
        TextSelection.create(ed.state.doc, head - 1, head),
      ),
    );
    expect(open(ed)).toBe(false);
  });

  it("closes on blur and on closeSlash, and reads as closed while read-only", () => {
    const ed = setup(para());
    caretAfter(ed, "");
    type(ed, "/");
    ed.view.dispatch(ed.state.tr.setMeta("blur", { event: null }));
    expect(open(ed)).toBe(false);

    type(ed, " /");
    closeSlash(ed);
    expect(open(ed)).toBe(false);
    // Esc's close leaves the typed text.
    expect(ed.state.selection.$from.parent.textContent).toBe("/ /");

    type(ed, " /");
    expect(open(ed)).toBe(true);
    // `setEditable` dispatches nothing; the host closes on its `update`.
    ed.setEditable(false);
    expect(open(ed)).toBe(false);
  });

  it("keeps the same state object while nothing visible changes", () => {
    const ed = setup(para());
    caretAfter(ed, "");
    type(ed, "/h");
    const snapshot = getSlashState(ed);
    ed.view.dispatch(ed.state.tr.setMeta("noop", true));
    ed.view.dispatch(
      ed.state.tr.setSelection(
        TextSelection.create(ed.state.doc, ed.state.selection.from),
      ),
    );
    expect(getSlashState(ed)).toBe(snapshot);
    type(ed, "e");
    expect(getSlashState(ed)).not.toBe(snapshot);
  });

  it("closing does not bump the toolbar version store (meta only)", () => {
    const ed = setup(para());
    caretAfter(ed, "");
    type(ed, "/");
    let bumps = 0;
    const unsubscribe = getEditorVersionStore(ed).subscribe(() => {
      bumps += 1;
    });
    closeSlash(ed);
    closeSlash(ed);
    unsubscribe();
    expect(bumps).toBe(0);
    expect(open(ed)).toBe(false);
  });

  it("never touches the editor's props or DOM attributes", () => {
    const ed = setup(para());
    const props = ed.options.editorProps;
    const before = [...ed.view.dom.attributes].map((a) => a.name).sort();
    caretAfter(ed, "");
    type(ed, "/");
    expect(open(ed)).toBe(true);
    expect([...ed.view.dom.attributes].map((a) => a.name).sort()).toEqual(
      before,
    );
    expect(ed.options.editorProps).toBe(props);
  });
});

describe("SlashTrigger: collaboration", () => {
  const collab = (server?: CollabEditorFixture["server"]) => {
    const fixture = createCollabEditor({
      server,
      extensions: [SlashTrigger] as Extension[],
    });
    fixtures.push(fixture);
    return fixture;
  };

  it("a remote '/' never opens", () => {
    const local = collab();
    const remote = collab(local.server);
    caretAfter(local.editor, "hello world");
    caretAfter(remote.editor, "hello world");
    type(remote.editor, " /");
    expect(local.editor.state.doc.textContent).toContain("hello world /");
    expect(open(local.editor)).toBe(false);
    expect(open(remote.editor)).toBe(true);
  });

  it("stays open, with the same query, through a remote insert before the '/'", () => {
    const local = collab();
    const remote = collab(local.server);
    caretAfter(local.editor, "hello world");
    type(local.editor, " /he");
    // The collaborator types at the paragraph's start.
    const title = local.editor.state.doc.firstChild?.nodeSize ?? 0;
    const start = 2 + title - 1;
    remote.editor.view.dispatch(remote.editor.state.tr.insertText("XY", start));
    expect(local.editor.state.doc.textContent).toContain("XYhello world /he");
    expect(open(local.editor)).toBe(true);
    expect(query(local.editor)).toBe("he");
    const state = getSlashState(local.editor);
    if (!state.open) throw new Error("closed");
    expect(local.editor.state.doc.textBetween(state.from, state.from + 1)).toBe(
      "/",
    );
    type(local.editor, "a");
    expect(query(local.editor)).toBe("hea");
  });

  it("closes when a collaborator deletes the '/'", () => {
    const local = collab();
    const remote = collab(local.server);
    caretAfter(local.editor, "hello world");
    type(local.editor, " /he");
    caretAfter(remote.editor, "hello world /he");
    const end = remote.editor.state.selection.from;
    remote.editor.view.dispatch(
      remote.editor.state.tr.delete(end - 3, end - 2),
    );
    expect(local.editor.state.doc.textContent).toContain("hello world he");
    expect(open(local.editor)).toBe(false);
  });
});
