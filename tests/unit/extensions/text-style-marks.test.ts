import { afterEach, describe, expect, it } from "bun:test";

import type { Editor, Extension, JSONContent } from "@tiptap/core";
import { ySyncPluginKey } from "@tiptap/y-tiptap";

import { FontSize, TextColor } from "@/extensions/text-style-marks";
import type { FontSizeToken, TextColorToken } from "@/lib/text-style-tokens";
import {
  createTestEditor,
  DEFAULT_EXTENSIONS,
} from "@/tests/helpers/create-test-editor";

const MARK_NAMES = new Set(["textColor", "fontSize"]);
const EXTENSIONS = [
  ...DEFAULT_EXTENSIONS.filter((e) => !MARK_NAMES.has(e.name)),
  TextColor,
  FontSize,
] as Extension[];

/** Title "Title", then paragraph "hello world" (text starts at pos 8). */
const DOC: JSONContent = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Title" }],
    },
    { type: "paragraph", content: [{ type: "text", text: "hello world" }] },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Section" }],
    },
  ],
};
const P_START = 8;

const editors: Editor[] = [];
function make(content: JSONContent = DOC) {
  const editor = createTestEditor({ extensions: EXTENSIONS, content });
  editors.push(editor);
  return editor;
}
afterEach(() => {
  for (const e of editors) e.destroy();
  editors.length = 0;
});

/** `[blockType, markType, attrValue]` for every marked text run. */
function runs(editor: Editor, mark: string) {
  const out: [string, string, unknown][] = [];
  editor.state.doc.descendants((node, _pos, parent) => {
    if (!node.isText) return;
    for (const m of node.marks) {
      if (m.type.name === mark)
        out.push([
          parent?.type.name ?? "",
          node.text ?? "",
          Object.values(m.attrs)[0],
        ]);
    }
  });
  return out;
}

const TAMPERED = [
  "__proto__",
  "constructor",
  "toString",
  "RED",
  "red ",
  "red;x",
  "red;background:url(x)",
  "var(--tt-color-text-red)",
  "#dc2626",
  "",
  "m",
  "md",
  "20px",
  "LG",
  42,
  null,
  undefined,
  {},
  ["red"],
];

describe("textColor mark", () => {
  it("applies a token as data-text-color, never a style", () => {
    const editor = make();
    expect(
      editor
        .chain()
        .setTextSelection({ from: P_START, to: P_START + 5 })
        .setTextColor("red")
        .run(),
    ).toBe(true);
    expect(editor.getHTML()).toContain('<span data-text-color="red">hello');
    expect(editor.getHTML()).not.toContain("style=");
  });

  it("refuses tampered tokens and changes nothing", () => {
    const editor = make();
    editor.commands.setTextSelection({ from: P_START, to: P_START + 5 });
    const before = editor.state.doc;
    for (const v of TAMPERED) {
      expect(editor.commands.setTextColor(v as TextColorToken)).toBe(false);
    }
    expect(editor.state.doc.eq(before)).toBe(true);
  });

  it("colours headings and the title too", () => {
    const editor = make();
    editor.chain().selectAll().setTextColor("teal").run();
    expect(runs(editor, "textColor").map(([block]) => block)).toEqual([
      "heading",
      "paragraph",
      "heading",
    ]);
  });

  it("an empty selection sets a stored mark for the next characters", () => {
    const editor = make();
    editor
      .chain()
      .setTextSelection(P_START + 5)
      .setTextColor("blue")
      .insertContent("X")
      .run();
    expect(runs(editor, "textColor")).toEqual([["paragraph", "X", "blue"]]);
  });

  it("is inclusive: typing at the end of coloured text continues it", () => {
    const editor = make();
    editor
      .chain()
      .setTextSelection({ from: P_START, to: P_START + 5 })
      .setTextColor("red")
      .setTextSelection(P_START + 5)
      .insertContent("o")
      .run();
    expect(runs(editor, "textColor")).toEqual([["paragraph", "helloo", "red"]]);
  });

  it("one colour per range: a new colour replaces the old one", () => {
    const editor = make();
    editor
      .chain()
      .setTextSelection({ from: P_START, to: P_START + 5 })
      .setTextColor("red")
      .setTextColor("green")
      .run();
    expect(runs(editor, "textColor")).toEqual([
      ["paragraph", "hello", "green"],
    ]);
  });

  it("unsetTextColor with an empty cursor removes the whole run", () => {
    const editor = make();
    editor
      .chain()
      .setTextSelection({ from: P_START, to: P_START + 5 })
      .setTextColor("red")
      .setTextSelection(P_START + 2)
      .unsetTextColor()
      .run();
    expect(runs(editor, "textColor")).toEqual([]);
  });

  it("parses its own spans and drops foreign and invalid colour", () => {
    const editor = make();
    editor.commands.setContent(
      '<h1>t</h1><p><span data-text-color="teal">a</span><span style="color:red">b</span><span data-text-color="red;x">c</span><font color="red">d</font></p>',
    );
    expect(runs(editor, "textColor")).toEqual([["paragraph", "a", "teal"]]);
    expect(editor.getText()).toContain("abcd");
  });

  it("cannot colour a code block", () => {
    const editor = make({
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
    editor.commands.setTextSelection({ from: 5, to: 8 });
    expect(editor.can().setTextColor("red")).toBe(false);
  });
});

describe("fontSize mark", () => {
  it("applies a size token in a paragraph as data-font-size", () => {
    const editor = make();
    editor
      .chain()
      .setTextSelection({ from: P_START, to: P_START + 5 })
      .setFontSize("lg")
      .run();
    expect(editor.getHTML()).toContain('<span data-font-size="lg">hello');
    expect(editor.getHTML()).not.toContain("style=");
  });

  it("refuses tampered tokens, including md (the unmarked default)", () => {
    const editor = make();
    editor.commands.setTextSelection({ from: P_START, to: P_START + 5 });
    const before = editor.state.doc;
    for (const v of TAMPERED) {
      expect(editor.commands.setFontSize(v as FontSizeToken)).toBe(false);
    }
    expect(editor.state.doc.eq(before)).toBe(true);
  });

  it("cannot size the title or a heading", () => {
    const editor = make();
    editor.commands.setTextSelection({ from: 2, to: 5 });
    expect(editor.can().setFontSize("lg")).toBe(false);
    expect(editor.commands.setFontSize("lg")).toBe(false);
    editor.commands.setTextSelection(3);
    expect(editor.commands.setFontSize("lg")).toBe(false);
    expect(editor.state.storedMarks ?? []).toEqual([]);
    expect(runs(editor, "fontSize")).toEqual([]);
  });

  it("a selection across headings and a paragraph sizes only the paragraph", () => {
    const editor = make();
    expect(editor.chain().selectAll().setFontSize("xl").run()).toBe(true);
    expect(runs(editor, "fontSize")).toEqual([
      ["paragraph", "hello world", "xl"],
    ]);
  });

  it("an empty selection sets a stored mark in a paragraph", () => {
    const editor = make();
    editor
      .chain()
      .setTextSelection(P_START + 5)
      .setFontSize("sm")
      .insertContent("X")
      .run();
    expect(runs(editor, "fontSize")).toEqual([["paragraph", "X", "sm"]]);
  });

  it("colour and size stack on the same text", () => {
    const editor = make();
    editor
      .chain()
      .setTextSelection({ from: P_START, to: P_START + 5 })
      .setFontSize("lg")
      .setTextColor("red")
      .run();
    expect(runs(editor, "fontSize")).toEqual([["paragraph", "hello", "lg"]]);
    expect(runs(editor, "textColor")).toEqual([["paragraph", "hello", "red"]]);
  });

  it("unsetFontSize removes the size", () => {
    const editor = make();
    editor
      .chain()
      .setTextSelection({ from: P_START, to: P_START + 5 })
      .setFontSize("xs")
      .setTextSelection(P_START + 1)
      .unsetFontSize()
      .run();
    expect(runs(editor, "fontSize")).toEqual([]);
  });

  it("is one transaction (one undo step)", () => {
    const editor = make();
    let count = 0;
    editor.on("transaction", ({ transaction }) => {
      if (transaction.docChanged) count += 1;
    });
    editor.commands.setTextSelection({ from: P_START, to: P_START + 5 });
    editor.commands.setFontSize("lg");
    expect(count).toBe(1);
  });

  it("parses its own spans and drops foreign and invalid sizes", () => {
    const editor = make();
    editor.commands.setContent(
      '<h1>t</h1><p><span data-font-size="sm">a</span><span style="font-size:18pt">b</span><span data-font-size="20px">c</span><font size="7">d</font></p>',
    );
    expect(runs(editor, "fontSize")).toEqual([["paragraph", "a", "sm"]]);
  });
});

describe("fontSize stays out of headings", () => {
  const sized = (): JSONContent => ({
    type: "doc",
    content: [
      DOC.content?.[0] as JSONContent,
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "big",
            marks: [
              { type: "fontSize", attrs: { size: "lg" } },
              { type: "textColor", attrs: { color: "red" } },
            ],
          },
        ],
      },
    ],
  });

  it("toggleHeading strips fontSize, keeps colour, in one undo step", () => {
    const editor = make(sized());
    editor
      .chain()
      .setTextSelection(P_START + 1)
      .toggleHeading({ level: 2 })
      .run();
    expect(runs(editor, "fontSize")).toEqual([]);
    expect(runs(editor, "textColor")).toEqual([["heading", "big", "red"]]);
    editor.commands.undo();
    expect(runs(editor, "fontSize")).toEqual([["paragraph", "big", "lg"]]);
  });

  it("paste into the title drops fontSize and keeps colour", () => {
    const editor = make();
    editor.commands.setTextSelection(3);
    editor.view.pasteHTML(
      '<span data-font-size="xl"><span data-text-color="red">Big</span></span>',
    );
    expect(runs(editor, "fontSize")).toEqual([]);
    expect(runs(editor, "textColor")).toEqual([["heading", "Big", "red"]]);
  });

  it("pasted headings lose fontSize; pasted paragraphs keep it", () => {
    const editor = make();
    editor.commands.setTextSelection(P_START + 11);
    editor.view.pasteHTML(
      '<h2><span data-font-size="xl">H</span></h2><p><span data-font-size="sm">p</span></p>',
    );
    expect(runs(editor, "fontSize")).toEqual([["paragraph", "p", "sm"]]);
  });

  it("typing with a stored fontSize in a heading writes no size", () => {
    const editor = make();
    editor.commands.setTextSelection(3);
    const { state } = editor;
    editor.view.dispatch(
      state.tr.addStoredMark(
        state.schema.marks.fontSize.create({ size: "lg" }),
      ),
    );
    editor.commands.insertContent("X");
    expect(runs(editor, "fontSize")).toEqual([]);
  });

  it("never rewrites a remote (Yjs) transaction", () => {
    const editor = make();
    const { state } = editor;
    const tr = state.tr
      .addMark(2, 5, state.schema.marks.fontSize.create({ size: "lg" }))
      .setMeta(ySyncPluginKey, { isChangeOrigin: true });
    editor.view.dispatch(tr);
    expect(runs(editor, "fontSize")).toEqual([["heading", "itl", "lg"]]);
  });
});
