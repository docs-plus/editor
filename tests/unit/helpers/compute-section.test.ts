import type { Node as PMNode } from "@tiptap/pm/model";
import { describe, expect, it } from "vitest";

import { computeSection } from "@/components/tiptap-node/heading-node/helpers/compute-section";
import { createTestEditor } from "@/tests/helpers/create-test-editor";

/** Returns 0-based position of child start (matches computeSection coordinate system). */
function getPositionForChild(doc: PMNode, childIndex: number): number {
  let offset = 0;
  for (let i = 0; i < childIndex; i++) {
    offset += doc.content.child(i).nodeSize;
  }
  return offset;
}

describe("computeSection", () => {
  it("H1 followed by paragraphs → section includes all until next H1", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Title" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "P1" }] },
          { type: "paragraph", content: [{ type: "text", text: "P2" }] },
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Next" }],
          },
        ],
      },
    });
    const doc = editor.state.doc;
    const h1Pos = getPositionForChild(doc, 0);
    const result = computeSection(doc, h1Pos, 1);
    expect(result.from).toBe(h1Pos);
    expect(result.to).toBe(getPositionForChild(doc, 3));
    editor.destroy();
  });

  it("H2 followed by H3 content then H2 → section stops at second H2", () => {
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
            content: [{ type: "text", text: "Section" }],
          },
          {
            type: "heading",
            attrs: { level: 3 },
            content: [{ type: "text", text: "Sub" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "Content" }] },
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Next H2" }],
          },
        ],
      },
    });
    const doc = editor.state.doc;
    const h2Pos = getPositionForChild(doc, 1);
    const result = computeSection(doc, h2Pos, 2);
    expect(result.from).toBe(h2Pos);
    expect(result.to).toBe(getPositionForChild(doc, 4));
    editor.destroy();
  });

  it("last heading in document → section extends to end of doc", () => {
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
            content: [{ type: "text", text: "Last" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "Trailing" }] },
        ],
      },
    });
    const doc = editor.state.doc;
    const h2Pos = getPositionForChild(doc, 1);
    const result = computeSection(doc, h2Pos, 2);
    expect(result.from).toBe(h2Pos);
    expect(result.to).toBe(doc.content.size);
    editor.destroy();
  });

  it("single heading (title only, no body) → section is just the heading", () => {
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
    const doc = editor.state.doc;
    const h1Pos = getPositionForChild(doc, 0);
    const result = computeSection(doc, h1Pos, 1);
    expect(result.from).toBe(h1Pos);
    expect(result.to).toBe(doc.content.size);
    editor.destroy();
  });

  it("heading at position 0 (title) → includes content until next H1 or end of doc", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Title" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "Intro" }] },
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Chapter" }],
          },
        ],
      },
    });
    const doc = editor.state.doc;
    const titlePos = getPositionForChild(doc, 0);
    const result = computeSection(doc, titlePos, 1);
    expect(result.from).toBe(titlePos);
    expect(result.to).toBe(doc.content.size);
    editor.destroy();
  });

  it("startChildIndex optimization → same result as without it", () => {
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
            content: [{ type: "text", text: "A" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "P" }] },
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "B" }],
          },
        ],
      },
    });
    const doc = editor.state.doc;
    const h2Pos = getPositionForChild(doc, 1);
    const withoutOpt = computeSection(doc, h2Pos, 2);
    const withOpt = computeSection(doc, h2Pos, 2, 1);
    expect(withOpt).toEqual(withoutOpt);
    editor.destroy();
  });
});
