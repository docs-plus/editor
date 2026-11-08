import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import { createTestEditor } from "@/tests/helpers/create-test-editor";

const title: JSONContent = {
  type: "heading",
  attrs: { level: 1 },
  content: [{ type: "text", text: "Title" }],
};

function topLevelTypes(blocks: JSONContent[]): string[] {
  const editor = createTestEditor();
  editor.commands.setContent({ type: "doc", content: blocks });
  const types: string[] = [];
  editor.state.doc.forEach((node) => {
    types.push(node.type.name);
  });
  editor.destroy();
  return types;
}

describe("trailing node", () => {
  it("does not append a node when the doc already ends with a paragraph", () => {
    expect(topLevelTypes([title, { type: "paragraph" }])).toEqual([
      "heading",
      "paragraph",
    ]);
  });

  it("appends a paragraph (not a heading) after a trailing heading", () => {
    expect(
      topLevelTypes([
        title,
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Section" }],
        },
      ]),
    ).toEqual(["heading", "heading", "paragraph"]);
  });

  it("appends a paragraph after a trailing non-paragraph block", () => {
    expect(
      topLevelTypes([
        title,
        { type: "codeBlock", content: [{ type: "text", text: "x" }] },
      ]),
    ).toEqual(["heading", "codeBlock", "paragraph"]);
  });
});
