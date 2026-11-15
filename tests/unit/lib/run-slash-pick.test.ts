import { afterEach, describe, expect, it } from "bun:test";

import { HyperMultimediaKit } from "@docs.plus/extension-hypermultimedia";
import type { Editor, Extension } from "@tiptap/core";
import { TableKit } from "@tiptap/extension-table";
import { TextSelection } from "@tiptap/pm/state";
import * as Y from "yjs";

import {
  getSlashState,
  SlashTrigger,
} from "@/extensions/slash-trigger/slash-trigger";
import { dismissNotice, getNotice } from "@/lib/announce";
import { READ_ONLY_REASON } from "@/lib/editor-actions/types";
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
  // The pill's store is module state shared by every test file.
  dismissNotice();
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

const item = (
  actionId: string,
  arg?: unknown,
  label = actionId,
): SlashItem => ({
  key: actionId,
  actionId,
  arg,
  label,
  keywords: [],
  section: "Text",
});

/** The pill's notice once `announceLater`'s import has settled. */
const said = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  return getNotice();
};

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

  it("a run that returns false puts the text back and leaves the caret after it", async () => {
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
    // The action could run here; it just did nothing: no reason to give.
    expect(await said()).toBeNull();
  });

  it("a pick refused since the menu opened says why on the pill, changing nothing", async () => {
    const editor = setup();
    slashInNewParagraph(editor, "quo");
    // A collaborator (or the writer, by shortcut) wraps the line in a quote.
    editor.commands.setBlockquote();
    expect(getSlashState(editor).open).toBe(true);
    const before = editor.state.doc;
    expect(runSlashPick(editor, item("insert.quote", undefined, "Quote"))).toBe(
      false,
    );
    expect(editor.state.doc.eq(before)).toBe(true);
    expect(getSlashState(editor).open).toBe(false);
    expect(await said()).toMatchObject({ text: "Quote: Already in a quote." });
    expect(getNotice()?.done).toBeUndefined();
  });

  it("a pick refused once its '/query' is gone says why and puts the text back", async () => {
    const editor = setup();
    slashInNewParagraph(editor, "quo");
    // The document turns read-only as "/quo" is deleted: only the run
    // sees it (a size refusal or a deletion lands mid-pick).
    let armed = true;
    const lock = () => {
      if (!armed || editor.state.selection.$head.parent.textContent) return;
      armed = false;
      editor.setEditable(false);
    };
    editor.on("transaction", lock);
    expect(runSlashPick(editor, item("insert.quote", undefined, "Quote"))).toBe(
      false,
    );
    editor.off("transaction", lock);
    expect(armed).toBe(false);
    expect(await said()).toMatchObject({
      text: `Quote: ${READ_ONLY_REASON}`,
    });
    const { $head } = editor.state.selection;
    expect($head.parent.textContent).toBe("/quo");
    expect($head.parentOffset).toBe(4);
  });

  it("refuses when the document became read-only after the menu opened", async () => {
    const editor = setup();
    slashInNewParagraph(editor, "h");
    editor.setEditable(false);
    const before = editor.state.doc;
    expect(runSlashPick(editor, item("style.heading2"))).toBe(false);
    expect(editor.state.doc.eq(before)).toBe(true);
    // The host has closed the menu: nothing was picked, nothing is said.
    expect(await said()).toBeNull();
  });

  it("refuses an unknown action and an unavailable one, changing nothing", async () => {
    const editor = setup();
    slashInNewParagraph(editor, "x");
    const before = editor.state.doc;
    expect(runSlashPick(editor, item("nope.nothing"))).toBe(false);
    expect(editor.state.doc.eq(before)).toBe(true);
    // A missing action is a bug, not something the writer can act on.
    expect(await said()).toBeNull();
  });

  describe("puts the text back where it was after changes made mid-pick", () => {
    /**
     * Picks "/emb" with an embed step that runs `meanwhile` (with "/emb"
     * gone) and then declines, so the text goes back.
     */
    function refuseAfter(editor: Editor, meanwhile: () => void): void {
      const off = onUiIntent(editor, () => {
        meanwhile();
        return false;
      });
      slashInNewParagraph(editor, "emb");
      expect(runSlashPick(editor, item("insert.embed"))).toBe(false);
      off();
    }

    /** Every top-level block as "type: text". */
    const blocks = (editor: Editor) => {
      const out: string[] = [];
      editor.state.doc.forEach((node) => {
        out.push(`${node.type.name}: ${node.textContent}`);
      });
      return out;
    };

    const expectCaretAfterEmb = (editor: Editor) => {
      const { $head, empty } = editor.state.selection;
      expect(empty).toBe(true);
      expect($head.parent.textContent).toBe("/emb");
      expect($head.parentOffset).toBe(4);
      expect(getSlashState(editor).open).toBe(false);
    };

    it("the line wrapped in a quote: inside the quote's paragraph", () => {
      const editor = setup();
      refuseAfter(editor, () => editor.commands.setBlockquote());
      expect(caretBlock(editor)).toEqual({
        type: "blockquote",
        level: undefined,
        text: "/emb",
      });
      expect(editor.state.selection.$head.parent.type.name).toBe("paragraph");
      expectCaretAfterEmb(editor);
    });

    it("a collaborator adds a paragraph above: on its own line", () => {
      const editor = setup();
      refuseAfter(editor, () =>
        fixture?.remote((frag) => {
          const p = new Y.XmlElement("paragraph");
          p.insert(0, [new Y.XmlText("from a collaborator")]);
          frag.insert(1, [p]);
        }),
      );
      expect(blocks(editor)).toEqual([
        "heading: Title",
        "paragraph: from a collaborator",
        "paragraph: hello world",
        "paragraph: /emb",
      ]);
      expectCaretAfterEmb(editor);
    });

    it("changes heard out of order (dispatched from a listener)", () => {
      const editor = setup();
      // Registered first, so its wrap is heard before the insert that
      // set it off, though it applies after it.
      let armed = false;
      const wrapOnce = () => {
        if (!armed) return;
        armed = false;
        editor.commands.setBlockquote();
      };
      editor.on("transaction", wrapOnce);
      refuseAfter(editor, () => {
        armed = true;
        // A collaborator's paragraph after the title; the caret stays put.
        const { schema, doc } = editor.state;
        const above = schema.nodes.paragraph.create(null, schema.text("above"));
        editor.view.dispatch(
          editor.state.tr.insert(doc.firstChild?.nodeSize ?? 0, above),
        );
      });
      editor.off("transaction", wrapOnce);
      expect(armed).toBe(false);
      expect(blocks(editor)).toEqual([
        "heading: Title",
        "paragraph: above",
        "paragraph: hello world",
        "blockquote: /emb",
        // The trailing node after the quote.
        "paragraph: ",
      ]);
      expectCaretAfterEmb(editor);
    });

    it("its line deleted: nothing comes back", () => {
      const editor = setup();
      refuseAfter(editor, () => {
        const { $head } = editor.state.selection;
        editor.view.dispatch(
          editor.state.tr.delete($head.before(), $head.after()),
        );
      });
      expect(JSON.stringify(editor.getJSON())).not.toContain("/emb");
      expect(blocks(editor)).toEqual([
        "heading: Title",
        "paragraph: hello world",
      ]);
    });
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
