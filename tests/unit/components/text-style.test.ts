import { afterEach, describe, expect, it } from "bun:test";

import type { Editor } from "@tiptap/core";

import { toggleList } from "@/components/tiptap-ui/list-button";
import {
  getListValue,
  setListType,
} from "@/components/tiptap-ui/list-dropdown-menu/use-list-dropdown-menu";
import { editorActions } from "@/lib/editor-actions";
import {
  getTextStyleValue,
  setTextStyle,
} from "@/lib/editor-actions/core/blocks";
import { computeContext } from "@/lib/editor-context/snapshot";
// The per-item lift is injected by this lazy module (spec §7.2).
import "@/lib/editor-actions/style-lift";

import { createTestEditor } from "../../helpers/create-test-editor";
import {
  blockquote,
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

  it("turns a list item or a quote into Text, unwrapped, in one step", () => {
    editor = createTestEditor({
      content: doc(
        h1("Title"),
        bulletList(listItem(p("Listed"))),
        blockquote(p("Quoted")),
      ).toJSON(),
    });
    editor.commands.setTextSelection(posInside(editor, "Listed"));
    expect(setTextStyle(editor, "paragraph")).toBe(true);
    expect(editor.state.doc.child(1).type.name).toBe("paragraph");
    editor.commands.setTextSelection(posInside(editor, "Quoted"));
    expect(setTextStyle(editor, "heading-2")).toBe(true);
    expect(editor.state.doc.child(2).type.name).toBe("heading");
    // Plain text stays a no-op.
    expect(setTextStyle(editor, "paragraph")).toBe(true);
    expect(setTextStyle(editor, "paragraph")).toBe(false);
  });

  /** Top-level blocks as `type:text`, lists and quotes with their children. */
  const shape = () => {
    const out: string[] = [];
    editor.state.doc.forEach((node) => {
      const kind =
        node.type.name === "heading" ? `h${node.attrs.level}` : node.type.name;
      const texts: string[] = [];
      node.descendants((child) => {
        if (child.isTextblock) texts.push(child.textContent);
        return !child.isTextblock;
      });
      out.push(
        node.isTextblock
          ? `${kind}:${node.textContent}`
          : `${kind}[${texts.join(",")}]`,
      );
    });
    // The trailing-node plugin's empty paragraph is not part of the shape.
    if (out.at(-1) === "paragraph:") out.pop();
    return out;
  };

  /** A `TextSelection` from inside `from` to inside `to`. */
  const selectBetween = (from: string, to: string) =>
    editor.commands.setTextSelection({
      from: posInside(editor, from),
      to: posInside(editor, to) + 2,
    });

  it("turns only the selected item of a list into Text; its siblings stay", () => {
    editor = createTestEditor({
      content: doc(
        h1("Title"),
        bulletList(
          listItem(p("One")),
          listItem(p("Two")),
          listItem(p("Three")),
        ),
      ).toJSON(),
    });
    editor.commands.setTextSelection(posInside(editor, "Two"));
    expect(setTextStyle(editor, "paragraph")).toBe(true);
    expect(shape()).toEqual([
      "h1:Title",
      "bulletList[One]",
      "paragraph:Two",
      "bulletList[Three]",
    ]);
    // One undo step.
    editor.commands.undo();
    expect(shape()).toEqual(["h1:Title", "bulletList[One,Two,Three]"]);
  });

  it("turns a word's item into Heading 2, never the whole list", () => {
    editor = createTestEditor({
      content: doc(
        h1("Title"),
        bulletList(
          listItem(p("One")),
          listItem(p("Two words")),
          listItem(p("Three")),
        ),
      ).toJSON(),
    });
    const at = posInside(editor, "words");
    editor.commands.setTextSelection({ from: at, to: at + 5 });
    expect(setTextStyle(editor, "heading-2")).toBe(true);
    expect(shape()).toEqual([
      "h1:Title",
      "bulletList[One]",
      "h2:Two words",
      "bulletList[Three]",
    ]);
  });

  it("lifts only the selected paragraph of a two-paragraph quote", () => {
    editor = createTestEditor({
      content: doc(h1("Title"), blockquote(p("First"), p("Second"))).toJSON(),
    });
    editor.commands.setTextSelection(posInside(editor, "Second"));
    expect(setTextStyle(editor, "paragraph")).toBe(true);
    expect(shape()).toEqual([
      "h1:Title",
      "blockquote[First]",
      "paragraph:Second",
    ]);
  });

  for (const [label, from, to] of [
    ["head in the list", "Lead", "One"],
    ["head in the paragraph", "One", "Tail"],
  ] as const) {
    it(`converts every selected block across a paragraph and a list (${label})`, () => {
      editor = createTestEditor({
        content: doc(
          h1("Title"),
          p("Lead"),
          bulletList(listItem(p("One")), listItem(p("Two"))),
          p("Tail"),
        ).toJSON(),
      });
      selectBetween(from, to);
      expect(setTextStyle(editor, "heading-3")).toBe(true);
      expect(shape()).toEqual(
        from === "Lead"
          ? [
              "h1:Title",
              "h3:Lead",
              "h3:One",
              "bulletList[Two]",
              "paragraph:Tail",
            ]
          : ["h1:Title", "paragraph:Lead", "h3:One", "h3:Two", "h3:Tail"],
      );
    });
  }

  it("turns a parent item into Text; its sub-items follow as a list", () => {
    editor = createTestEditor({
      content: doc(
        h1("Title"),
        bulletList(
          listItem(p("Alpha"), bulletList(listItem(p("Child")))),
          listItem(p("Beta")),
        ),
      ).toJSON(),
    });
    editor.commands.setTextSelection(posInside(editor, "Alpha"));
    expect(setTextStyle(editor, "paragraph")).toBe(true);
    expect(shape()).toEqual([
      "h1:Title",
      "paragraph:Alpha",
      "bulletList[Child]",
      "bulletList[Beta]",
    ]);
  });

  it("turns a middle child into a top-level Heading 2, in order", () => {
    editor = createTestEditor({
      content: doc(
        h1("Title"),
        bulletList(
          listItem(
            p("Parent"),
            bulletList(listItem(p("First")), listItem(p("Second"))),
          ),
        ),
      ).toJSON(),
    });
    editor.commands.setTextSelection(posInside(editor, "First"));
    expect(setTextStyle(editor, "heading-2")).toBe(true);
    const out = shape();
    expect(out[0]).toBe("h1:Title");
    expect(out[1]).toBe("bulletList[Parent]");
    expect(out[2]).toBe("h2:First");
    // Nothing is left inside a list item as a heading.
    expect(out.slice(3).join()).toContain("Second");
  });

  it("lifts a nested task item to the top level", () => {
    editor = createTestEditor({
      content: doc(
        h1("Title"),
        taskList(taskItem(p("Outer"), taskList(taskItem(p("Inner"))))),
      ).toJSON(),
    });
    editor.commands.setTextSelection(posInside(editor, "Inner"));
    expect(setTextStyle(editor, "paragraph")).toBe(true);
    expect(shape()).toEqual(["h1:Title", "taskList[Outer]", "paragraph:Inner"]);
  });

  it("names a list item List and a quote Quote (the row's face)", () => {
    editor = createTestEditor({
      content: doc(
        h1("Title"),
        bulletList(listItem(p("Listed"))),
        blockquote(p("Quoted")),
      ).toJSON(),
    });
    const value = () =>
      editorActions.get("style.paragraph")?.value?.(computeContext(editor));
    editor.commands.setTextSelection(posInside(editor, "Listed"));
    expect(value()).toBe("List");
    editor.commands.setTextSelection(posInside(editor, "Quoted"));
    expect(value()).toBe("Quote");
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
