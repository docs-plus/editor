import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { Editor, type JSONContent } from "@tiptap/core";
import type { Slice } from "@tiptap/pm/model";
import { Plugin } from "@tiptap/pm/state";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { buildDocumentEditorExtensions } from "@/components/document-editor/document-editor-config";
import { markdownPasteSlice } from "@/lib/markdown/parse";

/**
 * The Markdown paste rule (details spec E2) against the editor's real
 * extensions: images, embeds, Mermaid and the link rules included. The
 * rule must give nothing an HTML paste of the same content would not.
 */
let editor: Editor;

function buildEditor(): Editor {
  const extensions = buildDocumentEditorExtensions({
    documentId: "markdown-paste-test",
    ydoc: new Y.Doc(),
    awareness: {} as Awareness,
    getProvider: () => null,
    canWrite: () => true,
    onFoldChange() {},
    onFilterChange() {},
    onTocUpdate() {},
    // The Yjs binding and carets need a provider; the schema does not.
  }).filter((ext) => !ext.name.startsWith("collaboration"));
  return new Editor({
    element: document.createElement("div"),
    extensions,
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
}

beforeEach(() => {
  editor = buildEditor();
});

afterEach(() => {
  editor.destroy();
});

const parser = () => {
  if (!editor.markdown) throw new Error("no Markdown extension");
  return editor.markdown;
};

/** The pasted blocks, as JSON, or null when the rule leaves it as text. */
function slice(text: string): JSONContent[] | null {
  const result = markdownPasteSlice(parser(), editor.schema, text);
  return result ? (result.content.toJSON() as JSONContent[]) : null;
}

/** The body after pasting `html` at the caret, through ProseMirror. */
function bodyAfterHtmlPaste(html: string): JSONContent[] {
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  editor.view.pasteHTML(html);
  return (editor.getJSON().content ?? []).slice(1);
}

/** Every node of `blocks` with `type`, at any depth. */
function nodesOf(blocks: JSONContent[] | null, type: string): JSONContent[] {
  const found: JSONContent[] = [];
  const visit = (node: JSONContent) => {
    if (node.type === type) found.push(node);
    node.content?.forEach(visit);
  };
  blocks?.forEach(visit);
  return found;
}

/** Text nodes of `blocks`, each with the names of its marks. */
function texts(blocks: JSONContent[] | null) {
  return nodesOf(blocks, "text").map((node) => ({
    text: node.text,
    marks: (node.marks ?? []).map((mark) => mark.type),
  }));
}

describe("Markdown paste against the production schema", () => {
  it("drops script, event handlers and javascript: links from inline HTML", () => {
    const blocks = slice(
      '**bold** <img src=x onerror="alert(1)"> <script>alert(1)</script> <a href="javascript:alert(1)">x</a>',
    );
    expect(blocks?.map((block) => block.type)).toEqual(["paragraph"]);
    expect(texts(blocks)).toEqual([
      { text: "bold", marks: ["bold"] },
      { text: "   x", marks: [] },
    ]);
  });

  it("leaves Markdown with a raw HTML block as plain text", () => {
    // The parser read each of these as a level-1 heading (an empty one
    // for the image) instead of what an HTML paste makes of them.
    for (const text of [
      "**b**\n\n<img src=https://tracker.example/p.png>",
      "**b**\n\n<div>x</div>",
      "**b**\n\n<p>para</p>\n\nafter",
      "> **quoted**\n>\n> <div>x</div>",
      "- **item**\n\n  <div>x</div>",
      "**b**\n\n<iframe src=https://www.youtube.com/embed/abc></iframe>",
    ]) {
      expect({ text, blocks: slice(text) }).toEqual({ text, blocks: null });
    }
  });

  it("keeps HTML inside a code block as code", () => {
    expect(slice("```html\n<div>x</div>\n```")).toEqual([
      {
        type: "codeBlock",
        attrs: { language: "html" },
        content: [{ type: "text", text: "<div>x</div>" }],
      },
    ]);
  });

  it("keeps a Mermaid fence a code block, as typed", () => {
    expect(slice("```mermaid\ngraph TD; A-->B\n```")).toEqual([
      {
        type: "codeBlock",
        attrs: { language: "mermaid" },
        content: [{ type: "text", text: "graph TD; A-->B" }],
      },
    ]);
  });

  it("makes a Markdown image the image node an HTML <img> paste makes", () => {
    const src = "https://tracker.example/p.png";
    const markdown = nodesOf(slice(`![x](${src})`), "image");
    const html = nodesOf(bodyAfterHtmlPaste(`<img src="${src}">`), "image");
    expect(markdown.map((node) => node.attrs?.src)).toEqual([src]);
    expect(html.map((node) => node.attrs?.src)).toEqual([src]);
  });

  it("makes an image of a media URL in image syntax, never an embed", () => {
    for (const src of [
      "https://evil.example/v.mp4",
      "https://www.youtube.com/watch?v=abc",
    ]) {
      const blocks = slice(`![v](${src})`);
      expect(blocks?.map((block) => block.type)).toEqual(["image"]);
      expect(blocks?.[0].attrs?.src).toBe(src);
    }
  });

  it("drops iframes, listed embed hosts or not, as an HTML paste does", () => {
    // happy-dom reports each iframe it refuses to load; nothing loads.
    const quiet = spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const src of [
        "https://evil.example/x",
        "https://www.youtube.com/embed/abc",
      ]) {
        const iframe = `<iframe src="${src}"></iframe>`;
        expect(texts(slice(`**b** ${iframe}`))).toEqual([
          { text: "b", marks: ["bold"] },
          { text: " ", marks: [] },
        ]);
        expect(nodesOf(slice(`**b** ${iframe}`), "youtube")).toEqual([]);
        editor.commands.setContent({
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 1 },
              content: [{ type: "text", text: "Title" }],
            },
            { type: "paragraph" },
          ],
        });
        expect(bodyAfterHtmlPaste(`<p>a</p>${iframe}`)).toEqual([
          {
            type: "paragraph",
            attrs: { textAlign: null },
            content: [{ type: "text", text: "a" }],
          },
        ]);
      }
    } finally {
      quiet.mockRestore();
    }
  });

  it("drops a javascript: link and keeps its text, as an HTML paste does", () => {
    expect(texts(slice("**b** [x](javascript:alert(1))"))).toEqual([
      { text: "b", marks: ["bold"] },
      { text: " x", marks: [] },
    ]);
    expect(
      texts(bodyAfterHtmlPaste('<p><a href="javascript:alert(1)">x</a></p>')),
    ).toEqual([{ text: "x", marks: [] }]);
  });

  it("leaves a lone javascript: link as plain text", () => {
    expect(slice("[x](javascript:alert(1))")).toBeNull();
    expect(slice("[x](data:text/html,hi)")).toBeNull();
  });

  it("keeps a named https link", () => {
    expect(
      nodesOf(slice("[site](https://example.com)"), "text")[0].marks?.[0].attrs
        ?.href,
    ).toBe("https://example.com");
  });
});

describe("Markdown paste through ProseMirror's paste pipeline", () => {
  /** Wires the rule as the unwired hook will be: `clipboardTextParser`. */
  function wireRule(): void {
    editor.registerPlugin(
      new Plugin({
        props: {
          // `pasteText` always passes `plain` (⌘⇧V); a real ⌘V does not.
          // Typed as never null, but ProseMirror falls back to its plain
          // text parse when it is.
          clipboardTextParser: (text) =>
            markdownPasteSlice(parser(), editor.schema, text) as Slice,
        },
      }),
    );
  }

  it("gives headings in the paste their own ids (UniqueID's transformPasted)", () => {
    wireRule();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.view.pasteText("## One\n\n## Two\n\ntext with **bold**");
    const headings = nodesOf(editor.getJSON().content ?? [], "heading");
    expect(headings.map((node) => node.content?.[0]?.text)).toEqual([
      "Title",
      "One",
      "Two",
    ]);
    const ids = headings.map((node) => node.attrs?.["data-toc-id"]);
    expect(new Set(ids).size).toBe(3);
  });

  it("pastes plain text as before when the rule returns null", () => {
    wireRule();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.view.pasteText("## Heading\n\n<div>x</div>");
    expect(texts((editor.getJSON().content ?? []).slice(1))).toEqual([
      { text: "## Heading", marks: [] },
      { text: "<div>x</div>", marks: [] },
    ]);
  });
});
