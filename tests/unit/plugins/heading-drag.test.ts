import { describe, expect, it } from "vitest";
import { buildHandleDecos } from "@/components/tiptap-node/heading-node/helpers/drag-helpers";
import { createTestEditor } from "@/tests/helpers/create-test-editor";

describe("buildHandleDecos (HeadingDrag)", () => {
  it("single heading (title only): empty DecorationSet", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Title" }],
          },
        ],
      },
    });

    const decos = buildHandleDecos(editor.state.doc);
    expect(decos.find().length).toBe(0);
    editor.destroy();
  });

  it("multiple headings: one decoration per heading except title (pos > 0)", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Title" }],
          },
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Section A" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "Content" }] },
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Section B" }],
          },
        ],
      },
    });

    const doc = editor.state.doc;
    const decos = buildHandleDecos(doc);
    const found = decos.find();

    let headingCount = 0;
    doc.forEach((node, pos) => {
      if (node.type.name === "heading" && pos > 0) headingCount++;
    });

    expect(found.length).toBe(headingCount);
    expect(headingCount).toBe(2);
    editor.destroy();
  });

  it("document with headings and paragraphs: only headings (except title) get decorations", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1, "data-toc-id": "title" },
            content: [{ type: "text", text: "Title" }],
          },
          {
            type: "heading",
            attrs: { level: 2, "data-toc-id": "sec-a" },
            content: [{ type: "text", text: "Section A" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "Content A" }] },
          {
            type: "heading",
            attrs: { level: 3, "data-toc-id": "sec-a1" },
            content: [{ type: "text", text: "Subsection A1" }],
          },
          {
            type: "heading",
            attrs: { level: 2, "data-toc-id": "sec-b" },
            content: [{ type: "text", text: "Section B" }],
          },
        ],
      },
    });

    const decos = buildHandleDecos(editor.state.doc);
    const found = decos.find();

    expect(found.length).toBe(3);
    editor.destroy();
  });
});
