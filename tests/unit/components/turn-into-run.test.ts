import { afterEach, describe, expect, it } from "bun:test";

import type { Editor, JSONContent } from "@tiptap/core";
import { AllSelection } from "@tiptap/pm/state";

import {
  liftsInto,
  turnInto,
} from "@/components/smart-toolbar/row/turn-into-run";
import { dismissNotice, getNotice } from "@/lib/announce";
import { editorActions } from "@/lib/editor-actions";

import { createTestEditor } from "../../helpers/create-test-editor";
import { posInside } from "../../helpers/document-builders";

let editor: Editor;
afterEach(() => {
  editor?.destroy();
  dismissNotice();
});

const t = (text: string, marks?: JSONContent["marks"]): JSONContent => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});
const p = (...content: JSONContent[]): JSONContent => ({
  type: "paragraph",
  content,
});
const h = (level: number, text: string): JSONContent => ({
  type: "heading",
  attrs: { level },
  content: [t(text)],
});
const list = (...items: string[]): JSONContent => ({
  type: "bulletList",
  content: items.map((text) => ({ type: "listItem", content: [p(t(text))] })),
});
const cell = (text: string): JSONContent => ({
  type: "tableCell",
  content: [p(t(text))],
});

function make(...content: JSONContent[]) {
  editor = createTestEditor({ content: { type: "doc", content } });
}

/** Top-level blocks: `h2:text`, `paragraph:text`, or `list[a,b]`. */
function shape(): string[] {
  const out: string[] = [];
  editor.state.doc.forEach((node) => {
    const kind =
      node.type.name === "heading" ? `h${node.attrs.level}` : node.type.name;
    if (node.isTextblock) {
      out.push(`${kind}:${node.textContent}`);
      return;
    }
    const inner: string[] = [];
    node.descendants((child) => {
      if (!child.isTextblock) return true;
      inner.push(`${child.type.name}:${child.textContent}`);
      return false;
    });
    out.push(`${kind}[${inner.join(",")}]`);
  });
  // The trailing node's empty block (⌘A converts it too) is not content.
  while (/^\w+:$/.test(out.at(-1) ?? "")) out.pop();
  return out;
}

const action = (id: string) => {
  const found = editorActions.get(id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
};

/** `announceLater` imports the announcer: let it land. */
const notice = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  return getNotice()?.text;
};

const selectAll = () =>
  editor.view.dispatch(
    editor.state.tr.setSelection(new AllSelection(editor.state.doc)),
  );

describe("Turn into (spec §7.2)", () => {
  it("⌘A then a heading converts everything after the title, which stays", async () => {
    make(h(1, "Title"), p(t("Body")), list("One", "Two"));
    selectAll();
    expect(turnInto(editor, action("style.heading2"))).toBe(true);
    expect(shape()).toEqual(["h1:Title", "h2:Body", "h2:One", "h2:Two"]);
    expect(await notice()).toBe("The title stays a heading.");
  });

  it("⌘A then a list wraps everything after the title", () => {
    make(h(1, "Title"), p(t("Body")), p(t("More")));
    selectAll();
    expect(turnInto(editor, action("list.bullet"))).toBe(true);
    expect(shape()).toEqual([
      "h1:Title",
      "bulletList[paragraph:Body,paragraph:More]",
    ]);
  });

  it("Code block lifts the selected list items instead of skipping them", () => {
    make(h(1, "Title"), list("One", "Two", "Three"));
    editor.commands.setTextSelection(posInside(editor, "Two"));
    expect(turnInto(editor, action("insert.codeBlock"))).toBe(true);
    expect(shape()).toEqual([
      "h1:Title",
      "bulletList[paragraph:One]",
      "codeBlock:Two",
      "bulletList[paragraph:Three]",
    ]);
  });

  it("an open menu's rows dry-run the lift once per editor state", () => {
    make(h(1, "Title"), list("One", "Two", "Three"));
    editor.commands.setTextSelection(posInside(editor, "Two"));
    const can = editor.can.bind(editor);
    let dryRuns = 0;
    editor.can = () => {
      dryRuns += 1;
      return can();
    };
    // Every render of the open menu asks again; only the first runs it.
    for (let render = 0; render < 3; render += 1) {
      expect(liftsInto(editor, "insert.codeBlock")).toBe(true);
    }
    expect(dryRuns).toBe(1);
    // A new selection is a new state: asked again, run again.
    editor.commands.setTextSelection(posInside(editor, "One"));
    expect(liftsInto(editor, "insert.codeBlock")).toBe(true);
    expect(dryRuns).toBe(2);
  });

  it("Quote lifts a list item into a quote; its siblings stay", () => {
    make(h(1, "Title"), list("One", "Two", "Three"));
    editor.commands.setTextSelection(posInside(editor, "Two"));
    expect(turnInto(editor, action("insert.quote"))).toBe(true);
    expect(shape()).toEqual([
      "h1:Title",
      "bulletList[paragraph:One]",
      "blockquote[paragraph:Two]",
      "bulletList[paragraph:Three]",
    ]);
  });

  it("Code block over formatting says it was removed", async () => {
    make(h(1, "Title"), p(t("Bold", [{ type: "bold" }]), t(" plain")));
    const from = posInside(editor, "Bold");
    editor.commands.setTextSelection({ from, to: from + 10 });
    expect(turnInto(editor, action("insert.codeBlock"))).toBe(true);
    expect(shape()).toEqual(["h1:Title", "codeBlock:Bold plain"]);
    expect(await notice()).toBe("Formatting removed");
  });

  it("Heading 2 inside one table cell converts that cell's text, as on main", async () => {
    make(h(1, "Title"), {
      type: "table",
      content: [{ type: "tableRow", content: [cell("Cell")] }],
    });
    editor.commands.setTextSelection(posInside(editor, "Cell"));
    expect(turnInto(editor, action("style.heading2"))).toBe(true);
    expect(shape()).toEqual(["h1:Title", "table[heading:Cell]"]);
    expect(await notice()).not.toBe("Table cells keep their type.");
  });

  it("a range with a list inside a cell keeps that list as it is", () => {
    make(
      h(1, "Title"),
      p(t("Before")),
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [list("In cell")],
              },
            ],
          },
        ],
      },
      p(t("After")),
    );
    const from = posInside(editor, "Before");
    const to = posInside(editor, "After") + 2;
    editor.commands.setTextSelection({ from, to });
    expect(turnInto(editor, action("style.heading3"))).toBe(true);
    expect(shape()).toEqual([
      "h1:Title",
      "h3:Before",
      "table[paragraph:In cell]",
      "h3:After",
    ]);
    // The cell's list is still a list.
    let listInCell = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === "bulletList") listInCell = true;
    });
    expect(listInCell).toBe(true);
  });

  it("table cells keep their type; the rest converts", async () => {
    make(
      h(1, "Title"),
      p(t("Before")),
      {
        type: "table",
        content: [{ type: "tableRow", content: [cell("Cell")] }],
      },
      p(t("After")),
    );
    const from = posInside(editor, "Before");
    const to = posInside(editor, "After") + 2;
    editor.commands.setTextSelection({ from, to });
    expect(turnInto(editor, action("style.heading3"))).toBe(true);
    expect(shape()).toEqual([
      "h1:Title",
      "h3:Before",
      "table[paragraph:Cell]",
      "h3:After",
    ]);
    expect(await notice()).toBe("Table cells keep their type.");
  });
});
