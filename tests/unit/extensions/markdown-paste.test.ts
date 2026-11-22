import { afterEach, describe, expect, it } from "bun:test";

import { Editor, type JSONContent } from "@tiptap/core";
import type { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { buildDocumentEditorExtensions } from "@/components/document-editor/document-editor-config";
import type * as MarkdownPaste from "@/extensions/markdown-paste/markdown-paste";

import { importFresh, resetModules } from "../../helpers/import-fresh";

/**
 * The eager half of the Markdown paste (details spec E2): the
 * `clipboardTextParser` prop the editor's `EDITOR_PROPS` carries, with the
 * rule in a lazy chunk. Pasted through ProseMirror's own paste handler, as
 * the browser delivers a clipboard with only plain text.
 */
let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
  resetModules();
});

async function setup() {
  const paste = await importFresh<typeof MarkdownPaste>(
    "@/extensions/markdown-paste/markdown-paste",
  );
  const extensions = buildDocumentEditorExtensions({
    documentId: "markdown-paste-hook-test",
    ydoc: new Y.Doc(),
    awareness: {} as Awareness,
    getProvider: () => null,
    canWrite: () => true,
    onFoldChange() {},
    onFilterChange() {},
    onTocUpdate() {},
  }).filter((ext) => !ext.name.startsWith("collaboration"));
  editor = new Editor({
    element: document.createElement("div"),
    extensions,
    editorProps: { clipboardTextParser: paste.markdownTextParser },
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
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  return { paste, editor };
}

/** A paste event whose clipboard holds only `text/plain`. */
function pastePlainText(target: Editor, text: string, shift = false) {
  const dom = target.view.dom;
  // ProseMirror reads ⌘⇧V from the Shift key held at the paste.
  dom.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Shift", shiftKey: shift }),
  );
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: {
      types: ["text/plain"],
      getData: (type: string) => (type === "text/plain" ? text : ""),
    },
  });
  dom.dispatchEvent(event);
  dom.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift" }));
}

const body = (target: Editor): JSONContent[] =>
  (target.getJSON().content ?? []).slice(1);

/** Block types in the body, other than paragraphs. */
const formattedBlocks = (target: Editor): string[] =>
  body(target)
    .map((block) => block.type ?? "")
    .filter((type) => type !== "paragraph");

// Block syntax: Tiptap's own paste rules already turn inline `**bold**`
// into bold on any text paste, so only blocks show the hook at work.
const MARKDOWN = "## Section\n\n- one\n- two";

describe("Markdown paste hook", () => {
  it("pastes plain text until the rule's chunk has loaded", async () => {
    const { editor: e } = await setup();
    pastePlainText(e, MARKDOWN);
    expect(formattedBlocks(e)).toEqual([]);
    expect(e.state.doc.textContent).toContain("## Section");
  });

  it("pastes Markdown as formatting once the rule has loaded", async () => {
    const { paste, editor: e } = await setup();
    await paste.loadMarkdownPaste();
    pastePlainText(e, MARKDOWN);
    expect(formattedBlocks(e)).toEqual(["heading", "bulletList"]);
    expect(e.state.doc.textContent).not.toContain("##");
  });

  it("keeps ⌘⇧V plain text with the rule loaded", async () => {
    const { paste, editor: e } = await setup();
    await paste.loadMarkdownPaste();
    pastePlainText(e, MARKDOWN, true);
    expect(formattedBlocks(e)).toEqual([]);
    expect(e.state.doc.textContent).toContain("## Section");
  });

  it("leaves text without Markdown syntax as plain text", async () => {
    const { paste, editor: e } = await setup();
    await paste.loadMarkdownPaste();
    pastePlainText(e, "just words\n\nand more");
    expect(formattedBlocks(e)).toEqual([]);
    expect(e.state.doc.textContent).toContain("just words");
  });
});
