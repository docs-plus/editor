import { afterEach, describe, expect, it } from "bun:test";

import { Mermaid } from "@docs.plus/extension-mermaid";
import type { Editor, Extension, JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

import { editorActions } from "@/lib/editor-actions";
import {
  installV11Engine,
  resetV11EngineForTests,
} from "@/lib/editor-actions/v11-actions";
import { v11Engine } from "@/lib/editor-actions/v11-engine";
import { computeContext } from "@/lib/editor-context/snapshot";
import {
  buildSlashItems,
  matchSlashItems,
  type SlashItem,
  slashEmptyNote,
} from "@/lib/slash-menu/slash-items";

import {
  createTestEditor,
  DEFAULT_EXTENSIONS,
} from "../../helpers/create-test-editor";

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
  installV11Engine(v11Engine);
});

const TITLE: JSONContent = {
  type: "heading",
  attrs: { level: 1 },
  content: [{ type: "text", text: "Title" }],
};

function setup(blocks: JSONContent[], withMermaid = true): Editor {
  editor = createTestEditor({
    extensions: [
      ...DEFAULT_EXTENSIONS,
      ...(withMermaid ? [Mermaid] : []),
    ] as Extension[],
    content: { type: "doc", content: [TITLE, ...blocks] },
  });
  return editor;
}

/** Caret at the end of the first textblock containing `text` ("": empty). */
function caretIn(ed: Editor, text: string): void {
  let pos = -1;
  ed.state.doc.descendants((node, offset) => {
    if (pos >= 0) return false;
    const hit = text ? node.textContent.includes(text) : !node.content.size;
    if (node.isTextblock && hit) {
      pos = offset + 1 + node.content.size;
      return false;
    }
    return true;
  });
  ed.view.dispatch(
    ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos)),
  );
}

const SIZE = { rows: 4, cols: 2 };
const items = (ed: Editor) =>
  buildSlashItems(computeContext(ed), editorActions.list(), SIZE);
const keys = (list: readonly SlashItem[]) => list.map((item) => item.key);

describe("buildSlashItems", () => {
  it("lists Text, Lists, Insert and Diagrams in registry order", () => {
    const ed = setup([
      { type: "paragraph", content: [{ type: "text", text: "/" }] },
    ]);
    caretIn(ed, "/");
    const list = items(ed);
    expect([...new Set(list.map((item) => item.section))]).toEqual([
      "Text",
      "Lists",
      "Insert",
      "Diagrams",
    ]);
    expect(keys(list).slice(0, 10)).toEqual([
      "style.paragraph",
      "style.heading1",
      "style.heading2",
      "style.heading3",
      "style.heading4",
      "style.heading5",
      "style.heading6",
      "list.bullet",
      "list.ordered",
      "list.task",
    ]);
    const insert = list.filter((item) => item.section === "Insert");
    expect(keys(insert)).toEqual([
      "insert.image",
      "insert.embed",
      "insert.table",
      "insert.quote",
      "insert.codeBlock",
      "insert.divider",
    ]);
    // Never a toolbar-only group (marks, colours, alignment).
    expect(list.some((item) => item.actionId.startsWith("mark."))).toBe(false);
  });

  it("replaces Diagram with its templates once the engine is in", () => {
    const ed = setup([
      { type: "paragraph", content: [{ type: "text", text: "/" }] },
    ]);
    caretIn(ed, "/");
    const diagrams = items(ed).filter((item) => item.section === "Diagrams");
    expect(keys(diagrams)).toEqual([
      "template.mermaid:flowchart",
      "template.mermaid:sequence",
      "template.mermaid:state",
      "template.mermaid:mindmap",
      "template.mermaid:pie",
    ]);
    expect(diagrams.map((item) => item.label)).toEqual([
      "Flowchart",
      "Sequence diagram",
      "State diagram",
      "Mind map",
      "Pie chart",
    ]);
    expect(diagrams.every((item) => item.arg !== undefined)).toBe(true);
    expect(keys(items(ed))).not.toContain("insert.mermaid");

    resetV11EngineForTests();
    const before = items(ed);
    expect(before.some((item) => item.section === "Diagrams")).toBe(false);
    const diagram = before.find((item) => item.key === "insert.mermaid");
    expect(diagram?.label).toBe("Diagram");
    expect(diagram?.section).toBe("Insert");
  });

  it("marks unavailable actions with their reason, and never lists them", () => {
    const ed = setup(
      [
        {
          type: "blockquote",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "quoted" }] },
          ],
        },
      ],
      false,
    );
    caretIn(ed, "quoted");
    const built = items(ed);
    expect(built.find((item) => item.key === "insert.quote")?.reason).toBe(
      "Already in a quote.",
    );
    const list = keys(matchSlashItems(built, ""));
    expect(list).not.toContain("insert.quote");
    expect(keys(matchSlashItems(built, "quo"))).toEqual([]);
    // No Mermaid extension: neither the row nor templates.
    expect(list).not.toContain("insert.mermaid");
    expect(list.some((key) => key.startsWith("template."))).toBe(false);
    expect(list).toContain("style.heading2");

    ed.setEditable(false);
    expect(matchSlashItems(items(ed), "")).toEqual([]);
  });

  it("passes the remembered table size to insert.table and shows it", () => {
    const ed = setup([{ type: "paragraph", content: [] }]);
    caretIn(ed, "");
    const table = items(ed).find((item) => item.key === "insert.table");
    expect(table?.arg).toEqual(SIZE);
    expect(table?.note).toBe("4 × 2");
  });

  it("carries the icon, the Markdown hint and the last used template", () => {
    const ed = setup([{ type: "paragraph", content: [] }]);
    caretIn(ed, "");
    const list = items(ed);
    const h2 = list.find((item) => item.key === "style.heading2");
    expect(h2?.hint).toBe("##");
    expect(h2?.icon).toBeDefined();
    expect(list.find((item) => item.key === "insert.quote")?.hint).toBe(">");
    // Every row has an icon (Normal text has none in the registry).
    expect(list.every((item) => item.icon !== undefined)).toBe(true);
  });
});

describe("matchSlashItems", () => {
  function all(): SlashItem[] {
    const ed = setup([{ type: "paragraph", content: [] }]);
    caretIn(ed, "");
    return items(ed);
  }

  it("lists all but Heading 4–6 for an empty query; a query finds them", () => {
    const list = all();
    const shown = keys(matchSlashItems(list, ""));
    expect(shown).toEqual(
      keys(list).filter((key) => !/^style\.heading[4-6]$/.test(key)),
    );
    expect(keys(matchSlashItems(list, "h5"))[0]).toBe("style.heading5");
    expect(keys(matchSlashItems(list, "####"))[0]).toBe("style.heading4");
  });

  it("keeps each section together, best match first", () => {
    const list = all();
    for (const query of ["b", "c", "l", "t", "d"]) {
      const sections = matchSlashItems(list, query).map((item) => item.section);
      const runs = sections.filter((s, i) => s !== sections[i - 1]);
      expect(new Set(runs).size).toBe(runs.length);
    }
    // "/b": Bullet list leads, its section first.
    expect(keys(matchSlashItems(list, "b"))[0]).toBe("list.bullet");
  });

  it("puts the last used template first among diagram ties ('/dia')", () => {
    const list = all();
    const used = list.find((item) => item.lead);
    const diagrams = matchSlashItems(list, "dia");
    expect(diagrams.every((item) => item.section === "Diagrams")).toBe(true);
    if (used) expect(diagrams[0].key).toBe(used.key);
    else expect(diagrams[0].key).toBe("template.mermaid:flowchart");
    // The spoken label stays whole.
    expect(diagrams.map((item) => item.label)).toContain("Sequence diagram");
  });

  it("finds Divider by '---' after Typography made it '—-'", () => {
    const list = all();
    expect(keys(matchSlashItems(list, "—-"))[0]).toBe("insert.divider");
  });

  it("matches word prefixes of labels, keywords and Markdown hints", () => {
    const list = all();
    const first = (query: string) => matchSlashItems(list, query)[0]?.key;
    expect(first("h2")).toBe("style.heading2");
    expect(first("##")).toBe("style.heading2");
    expect(first("quo")).toBe("insert.quote");
    expect(first("pic")).toBe("insert.image");
    expect(first("num")).toBe("list.ordered");
    expect(first("todo")).toBe("list.task");
    expect(first("pie")).toBe("template.mermaid:pie");
    expect(first("Heading 3")).toBe("style.heading3");
    expect(first("head 4")).toBe("style.heading4");
    expect(first("text")).toBe("style.paragraph");
  });

  it("ranks label prefix > word prefix > keyword > hint, ties in registry order", () => {
    const list = all();
    const order = keys(matchSlashItems(list, "list"));
    // "List…" is no label's prefix; the word "list" is in three labels.
    expect(order.slice(0, 3)).toEqual([
      "list.bullet",
      "list.ordered",
      "list.task",
    ]);
    const heading = keys(matchSlashItems(list, "heading"));
    expect(heading.slice(0, 6)).toEqual([
      "style.heading1",
      "style.heading2",
      "style.heading3",
      "style.heading4",
      "style.heading5",
      "style.heading6",
    ]);
    // "code": Code block's label beats keyword matches elsewhere.
    expect(keys(matchSlashItems(list, "code"))[0]).toBe("insert.codeBlock");
  });

  it("says why a match cannot go here, else that nothing matches", () => {
    const ed = setup(
      [
        {
          type: "blockquote",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "quoted" }] },
          ],
        },
      ],
      false,
    );
    caretIn(ed, "quoted");
    const built = items(ed);
    expect(slashEmptyNote(built, "quote")).toBe("Quote: Already in a quote.");
    expect(slashEmptyNote(built, "zzz")).toBe("No matching blocks");
    expect(slashEmptyNote(built, "")).toBe("No matching blocks");
  });

  it("is case-insensitive and returns nothing for no match", () => {
    const list = all();
    expect(matchSlashItems(list, "QUOTE")[0]?.key).toBe("insert.quote");
    expect(matchSlashItems(list, "zzz")).toEqual([]);
  });
});
