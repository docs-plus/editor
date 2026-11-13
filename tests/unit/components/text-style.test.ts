import { afterEach, describe, expect, it } from "bun:test";

import type { Editor } from "@tiptap/core";

import { toggleList } from "@/components/tiptap-ui/list-button";
import {
  getListValue,
  setListType,
} from "@/components/tiptap-ui/list-dropdown-menu/use-list-dropdown-menu";
import {
  getTextStyleValue,
  setTextStyle,
} from "@/lib/editor-actions/core/blocks";

import { createTestEditor } from "../../helpers/create-test-editor";
import {
  bulletList,
  doc,
  h1,
  h2,
  listItem,
  orderedList,
  p,
  posInside,
  taskItem,
  taskList,
} from "../../helpers/document-builders";

let editor: Editor;

function setup() {
  editor = createTestEditor({
    content: doc(h1("Title"), h2("Section"), p("Body")).toJSON(),
  });
}

afterEach(() => editor?.destroy());

describe("text style", () => {
  it("reads Title in the first block and Heading 2 in a level-2 heading", () => {
    setup();
    editor.commands.setTextSelection(2);
    expect(getTextStyleValue(editor)).toBe("title");
    editor.commands.setTextSelection(posInside(editor, "Section"));
    expect(getTextStyleValue(editor)).toBe("heading-2");
    editor.commands.setTextSelection(posInside(editor, "Body"));
    expect(getTextStyleValue(editor)).toBe("paragraph");
  });

  it("sets, never toggles, the text style", () => {
    setup();
    editor.commands.setTextSelection(posInside(editor, "Section"));
    expect(setTextStyle(editor, "heading-2")).toBe(false);
    expect(getTextStyleValue(editor)).toBe("heading-2");
    expect(setTextStyle(editor, "paragraph")).toBe(true);
    expect(getTextStyleValue(editor)).toBe("paragraph");
    expect(setTextStyle(editor, "heading-3")).toBe(true);
    expect(getTextStyleValue(editor)).toBe("heading-3");
  });

  it("leaves the title alone", () => {
    setup();
    editor.commands.setTextSelection(2);
    expect(setTextStyle(editor, "paragraph")).toBe(false);
    expect(getTextStyleValue(editor)).toBe("title");
  });
});

describe("list type", () => {
  it("switches and removes lists without toggling", () => {
    setup();
    editor.commands.setTextSelection(posInside(editor, "Body"));
    expect(setListType(editor, "bulletList")).toBe(true);
    expect(setListType(editor, "bulletList")).toBe(false);
    expect(setListType(editor, "orderedList")).toBe(true);
    expect(getListValue(editor)).toBe("orderedList");
    expect(setListType(editor, "none")).toBe(true);
    expect(getListValue(editor)).toBe("none");
    expect(setListType(editor, "none")).toBe(false);
  });
});

describe("switching list type", () => {
  type Node = ReturnType<typeof doc>;

  function setupList(list: Node, caretIn = "Two") {
    editor = createTestEditor({ content: doc(h1("Title"), list).toJSON() });
    editor.commands.setTextSelection(posInside(editor, caretIn));
  }

  /** The second top-level block: the list under test. */
  const listJSON = () => editor.getJSON().content?.[1];

  const threeBullets = () =>
    bulletList(listItem(p("One")), listItem(p("Two")), listItem(p("Three")));

  it("keeps every item in one list when switching bullet to ordered", () => {
    setupList(threeBullets());
    const blocks = editor.state.doc.childCount;
    expect(setListType(editor, "orderedList")).toBe(true);
    expect(editor.state.doc.childCount).toBe(blocks);
    expect(listJSON()).toEqual(
      orderedList(
        listItem(p("One")),
        listItem(p("Two")),
        listItem(p("Three")),
      ).toJSON(),
    );
  });

  it("keeps nesting when switching type", () => {
    setupList(
      bulletList(
        listItem(p("One"), bulletList(listItem(p("Two")))),
        listItem(p("Three")),
      ),
    );
    expect(setListType(editor, "orderedList")).toBe(true);
    expect(listJSON()).toEqual(
      orderedList(
        listItem(p("One"), orderedList(listItem(p("Two")))),
        listItem(p("Three")),
      ).toJSON(),
    );
  });

  it("switches bullet to task and back with every item", () => {
    setupList(threeBullets());
    expect(setListType(editor, "taskList")).toBe(true);
    expect(listJSON()).toEqual(
      taskList(
        taskItem(p("One")),
        taskItem(p("Two")),
        taskItem(p("Three")),
      ).toJSON(),
    );
    expect(setListType(editor, "bulletList")).toBe(true);
    expect(listJSON()).toEqual(threeBullets().toJSON());
  });

  it("switches a nested task list to bullets", () => {
    setupList(
      taskList(
        taskItem({ checked: true }, p("One"), taskList(taskItem(p("Two")))),
        taskItem(p("Three")),
      ),
    );
    expect(setListType(editor, "bulletList")).toBe(true);
    expect(listJSON()).toEqual(
      bulletList(
        listItem(p("One"), bulletList(listItem(p("Two")))),
        listItem(p("Three")),
      ).toJSON(),
    );
  });

  it("keeps checked state in a nested task list that stays a task list", () => {
    setupList(
      bulletList(
        listItem(p("One"), taskList(taskItem({ checked: true }, p("Two")))),
      ),
    );
    expect(setListType(editor, "taskList")).toBe(true);
    expect(listJSON()).toEqual(
      taskList(
        taskItem(p("One"), taskList(taskItem({ checked: true }, p("Two")))),
      ).toJSON(),
    );
  });

  it("switches in place from the list buttons too", () => {
    setupList(
      bulletList(
        listItem(p("One"), bulletList(listItem(p("Two")))),
        listItem(p("Three")),
      ),
    );
    expect(toggleList(editor, "taskList")).toBe(true);
    expect(listJSON()).toEqual(
      taskList(
        taskItem(p("One"), taskList(taskItem(p("Two")))),
        taskItem(p("Three")),
      ).toJSON(),
    );
  });

  it("keeps the caret where it was", () => {
    setupList(threeBullets());
    const { from } = editor.state.selection;
    setListType(editor, "taskList");
    expect(editor.state.selection.from).toBe(from);
    expect(getListValue(editor)).toBe("taskList");
  });

  it("switches in one undo step", () => {
    setupList(threeBullets());
    const before = editor.getJSON();
    let docChanges = 0;
    editor.on("transaction", ({ transaction }) => {
      if (transaction.docChanged) docChanges += 1;
    });
    setListType(editor, "orderedList");
    expect(docChanges).toBe(1);
    editor.commands.undo();
    expect(editor.getJSON()).toEqual(before);
  });

  it("lifts every item with No list", () => {
    setupList(threeBullets());
    expect(setListType(editor, "none")).toBe(true);
    expect(editor.getJSON().content?.slice(1, 4)).toEqual([
      p("One").toJSON(),
      p("Two").toJSON(),
      p("Three").toJSON(),
    ]);
  });

  it("lifts nested items with No list too", () => {
    setupList(
      bulletList(
        listItem(p("One"), bulletList(listItem(p("Two")))),
        listItem(p("Three")),
      ),
    );
    expect(setListType(editor, "none")).toBe(true);
    expect(getListValue(editor)).toBe("none");
    expect(editor.getJSON().content?.slice(1, 4)).toEqual([
      p("One").toJSON(),
      p("Two").toJSON(),
      p("Three").toJSON(),
    ]);
  });
});
