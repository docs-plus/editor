import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { Editor, Extension, JSONContent } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import { TextSelection } from "@tiptap/pm/state";
import { Marked, type marked } from "marked";

import {
  hasMarkdownFormatting,
  hasMarkdownSyntax,
  markdownPasteSlice,
  parseMarkdownFragment,
} from "@/lib/markdown/parse";
import {
  createTestEditor,
  DEFAULT_EXTENSIONS,
} from "@/tests/helpers/create-test-editor";

/** The sample the exit criterion pastes: every block and mark Markdown has. */
const SAMPLE = [
  "## Heading two",
  "Some **bold**, *italic*, ~~struck~~ and `code` text with a [link](https://example.com).",
  "- one\n- two\n  - nested",
  "1. first\n2. second",
  "- [ ] todo\n- [x] done",
  "> quoted",
  "```js\nconst a = 1;\n```",
  "---",
  "| a | b |\n| --- | --- |\n| 1 | 2 |",
].join("\n\n");

let editor: Editor;

beforeEach(() => {
  editor = createTestEditor({
    extensions: [
      ...DEFAULT_EXTENSIONS,
      Markdown.configure({ marked: new Marked() as unknown as typeof marked }),
    ] as Extension[],
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        { type: "paragraph" },
      ],
    },
  });
});

afterEach(() => {
  editor.destroy();
});

const parser = () => {
  if (!editor.markdown) throw new Error("no Markdown extension");
  return editor.markdown;
};

/** Markdown for the body: each top-level block, blank-line separated. */
function bodyMarkdown(): string {
  const blocks: string[] = [];
  editor.state.doc.forEach((node, _offset, index) => {
    if (index === 0 || (node.type.name === "paragraph" && !node.content.size)) {
      return;
    }
    blocks.push(parser().serialize(node.toJSON()).trim());
  });
  return blocks.join("\n\n");
}

/** Pastes `slice` at the caret in the (empty) body paragraph. */
function pasteIntoBody(text: string): boolean {
  const slice = markdownPasteSlice(parser(), editor.schema, text);
  if (!slice) return false;
  const end = editor.state.doc.content.size - 1;
  editor.view.dispatch(
    editor.state.tr
      .setSelection(TextSelection.create(editor.state.doc, end))
      .replaceSelection(slice),
  );
  return true;
}

describe("hasMarkdownSyntax", () => {
  it.each([
    "# Title",
    "### Deep",
    "- item",
    "* item",
    "1. first",
    "> quote",
    "```\ncode\n```",
    "~~~\ncode\n~~~",
    "---",
    "some **bold** text",
    "some __bold__ text",
    "an *emphasis* here",
    "inline `code` here",
    "a [link](https://x.y)",
    "![alt](https://x.y/a.png)",
    "~~gone~~",
    "| a | b |\n| --- | --- |",
  ])("finds syntax in %p", (text) => {
    expect(hasMarkdownSyntax(text)).toBe(true);
  });

  it.each([
    "Just a sentence.",
    "Two lines\nof plain text",
    "2 * 3 * 4 = 24",
    "https://example.com/a_b_c",
    "snake_case_name and file_name.txt",
    "    indented by four spaces",
    "#hashtag without a space",
    "",
  ])("finds none in %p", (text) => {
    expect(hasMarkdownSyntax(text)).toBe(false);
  });
});

describe("hasMarkdownFormatting", () => {
  const paragraph = (...content: JSONContent[]): JSONContent => ({
    type: "doc",
    content: [{ type: "paragraph", content }],
  });

  it("is false for plain paragraphs", () => {
    expect(hasMarkdownFormatting(paragraph({ type: "text", text: "a" }))).toBe(
      false,
    );
  });

  it("is false for a bare URL the parser turned into a link", () => {
    for (const [text, href] of [
      ["https://example.com", "https://example.com"],
      ["www.example.com", "http://www.example.com"],
      ["me@example.com", "mailto:me@example.com"],
    ]) {
      const json = paragraph({
        type: "text",
        text,
        marks: [{ type: "hyperlink", attrs: { href } }],
      });
      expect(hasMarkdownFormatting(json)).toBe(false);
    }
  });

  it("is true for a mark, a named link or a block other than a paragraph", () => {
    expect(
      hasMarkdownFormatting(
        paragraph({ type: "text", text: "b", marks: [{ type: "bold" }] }),
      ),
    ).toBe(true);
    expect(
      hasMarkdownFormatting(
        paragraph({
          type: "text",
          text: "site",
          marks: [{ type: "hyperlink", attrs: { href: "https://x.y" } }],
        }),
      ),
    ).toBe(true);
    expect(
      hasMarkdownFormatting({
        type: "doc",
        content: [{ type: "horizontalRule" }],
      }),
    ).toBe(true);
  });
});

describe("markdownPasteSlice (details spec E2)", () => {
  it("round-trips the Markdown sample", () => {
    expect(pasteIntoBody(SAMPLE)).toBe(true);
    expect(bodyMarkdown().replace(/ +\|/g, " |")).toBe(SAMPLE);
  });

  it("keeps the title first and a level-1 title", () => {
    pasteIntoBody("# Pasted H1\n\ntext with **bold**");
    const { doc } = editor.state;
    expect(doc.child(0).type.name).toBe("heading");
    expect(doc.child(0).attrs.level).toBe(1);
    expect(doc.child(0).textContent).toBe("Title");
    expect(doc.child(1).textContent).toBe("Pasted H1");
  });

  it("merges a one-paragraph paste into the paragraph at the caret", () => {
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "T" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "Before " }] },
      ],
    });
    pasteIntoBody("**bold** after");
    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.child(1).textContent).toBe("Before bold after");
  });

  it("returns null for plain text, so the editor pastes it as before", () => {
    expect(
      markdownPasteSlice(parser(), editor.schema, "Just text."),
    ).toBeNull();
    expect(
      markdownPasteSlice(parser(), editor.schema, "one\n\ntwo paragraphs"),
    ).toBeNull();
  });

  it("returns null for a bare URL (the link and embed paste rules own it)", () => {
    expect(
      markdownPasteSlice(parser(), editor.schema, "https://example.com"),
    ).toBeNull();
    expect(
      markdownPasteSlice(
        parser(),
        editor.schema,
        "https://www.youtube.com/watch?v=abc_def",
      ),
    ).toBeNull();
  });

  it("returns null when the parse does not fit the schema", () => {
    const broken = {
      parse: () => ({
        type: "doc",
        content: [{ type: "noSuchNode", content: [] }],
      }),
    };
    expect(markdownPasteSlice(broken, editor.schema, "**x**")).toBeNull();
  });

  it("keeps raw HTML in Markdown to what an HTML paste allows", () => {
    const slice = markdownPasteSlice(
      parser(),
      editor.schema,
      '**bold** <img src=x onerror="alert(1)"> <script>alert(1)</script> <a href="javascript:alert(1)">x</a>',
    );
    const json = JSON.stringify(slice?.content.toJSON() ?? null);
    expect(json).not.toContain("onerror");
    expect(json).not.toContain("<script");
    expect(json).not.toContain("javascript:");
  });
});

describe("parseMarkdownFragment (shared with IM1)", () => {
  it("returns schema-checked blocks", () => {
    const fragment = parseMarkdownFragment(parser(), editor.schema, SAMPLE);
    const types: string[] = [];
    fragment.forEach((node) => {
      types.push(node.type.name);
    });
    expect(types).toEqual([
      "heading",
      "paragraph",
      "bulletList",
      "orderedList",
      "taskList",
      "blockquote",
      "codeBlock",
      "horizontalRule",
      "table",
    ]);
  });

  it("throws on content the schema can't hold", () => {
    const broken = {
      parse: () => ({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "heading" }] }],
      }),
    };
    expect(() => parseMarkdownFragment(broken, editor.schema, "x")).toThrow();
  });
});
