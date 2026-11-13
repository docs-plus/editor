import { describe, expect, it } from "bun:test";

import type { HocuspocusProvider } from "@hocuspocus/provider";
import { Editor } from "@tiptap/core";
import { marked } from "marked";
import * as Y from "yjs";

import { buildDocumentEditorExtensions } from "@/components/document-editor/document-editor-config";

/** The app's extensions, minus the two that need a live provider. */
function buildEditor(): Editor {
  const extensions = buildDocumentEditorExtensions({
    documentId: "markdown-test",
    ydoc: new Y.Doc(),
    provider: {} as HocuspocusProvider,
    onFoldChange() {},
    onFilterChange() {},
    onTocUpdate() {},
  }).filter((ext) => !ext.name.startsWith("collaboration"));
  return new Editor({ element: document.createElement("div"), extensions });
}

const globalTokenizerCount = () => {
  const ext = marked.defaults.extensions;
  return (ext?.inline?.length ?? 0) + (ext?.block?.length ?? 0);
};

describe("document editor markdown", () => {
  // Every editor used to register its tokenizers on the module-wide
  // `marked`, which kept each destroyed editor reachable for the page's life.
  it("registers no tokenizers on the shared marked instance", () => {
    const before = globalTokenizerCount();
    for (let i = 0; i < 3; i++) buildEditor().destroy();
    expect(globalTokenizerCount()).toBe(before);
  });

  it("gives each editor its own marked instance", () => {
    const a = buildEditor();
    const b = buildEditor();
    try {
      expect(a.markdown?.instance).not.toBe(marked);
      expect(a.markdown?.instance).not.toBe(b.markdown?.instance);
      // The tokenizers land on the editor's own instance instead.
      const own = a.markdown?.instance.defaults.extensions?.inline ?? [];
      expect(own.length).toBeGreaterThan(0);
      // The editor still parses markdown with its own tokenizers.
      expect(a.markdown?.parse("**bold**").content?.[0]?.type).toBe(
        "paragraph",
      );
    } finally {
      a.destroy();
      b.destroy();
    }
  });
});
