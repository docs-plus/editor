import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { Editor, JSONContent } from "@tiptap/core";

import { CONTINUE_NAV } from "@/components/document-editor/continue-chip-loader";
import { createTestEditor } from "@/tests/helpers/create-test-editor";

const heading = (text: string, id: string, level = 2): JSONContent => ({
  type: "heading",
  attrs: { level, "data-toc-id": id, id },
  content: [{ type: "text", text }],
});
const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

describe("continue chip navigation port", () => {
  let editor: Editor;
  beforeEach(() => {
    editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          heading("Title", "title", 1),
          heading("Walrus notes", "walrus"),
          paragraph("tusks"),
          heading("Zebra notes", "zebra"),
          paragraph("stripes"),
        ],
      },
    });
  });
  afterEach(() => editor.destroy());

  it("isFilteredOut: no filter hides nothing", () => {
    expect(CONTINUE_NAV.isFilteredOut(editor.state, "zebra")).toBe(false);
  });

  it("isFilteredOut: a filter hides the sections it does not match", () => {
    editor.commands.applyFilter(["walrus"], "or");
    expect(CONTINUE_NAV.isFilteredOut(editor.state, "zebra")).toBe(true);
    expect(CONTINUE_NAV.isFilteredOut(editor.state, "walrus")).toBe(false);
  });

  it("find looks the heading up by id as the document is now", () => {
    expect(CONTINUE_NAV.find(editor.state.doc, "zebra")?.node.textContent).toBe(
      "Zebra notes",
    );
    expect(CONTINUE_NAV.find(editor.state.doc, "gone")).toBeNull();
  });
});
