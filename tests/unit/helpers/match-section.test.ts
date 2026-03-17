import type { JSONContent } from "@tiptap/core";
import { describe, expect, it } from "vitest";

import {
  filterSections,
  findAllSections,
  matchSections,
} from "@/components/tiptap-node/heading-node/helpers/match-section";
import { createTestEditor } from "@/tests/helpers/create-test-editor";

const DOC_WITH_SECTIONS = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1, "data-toc-id": "title" },
      content: [{ type: "text", text: "Title" }],
    },
    {
      type: "heading",
      attrs: { level: 2, "data-toc-id": "intro" },
      content: [{ type: "text", text: "Introduction" }],
    },
    { type: "paragraph", content: [{ type: "text", text: "Some intro text" }] },
    {
      type: "heading",
      attrs: { level: 3, "data-toc-id": "setup" },
      content: [{ type: "text", text: "Setup Guide" }],
    },
    {
      type: "heading",
      attrs: { level: 2, "data-toc-id": "api" },
      content: [{ type: "text", text: "API Reference" }],
    },
  ],
};

function createEditorWithToc(content: JSONContent) {
  return createTestEditor({ content });
}

describe("findAllSections", () => {
  it("skips title H1 (index 0), returns correct section list with IDs, positions, levels", () => {
    const editor = createEditorWithToc(DOC_WITH_SECTIONS);
    const doc = editor.state.doc;
    const sections = findAllSections(doc);
    expect(sections.length).toBe(3);
    expect(sections[0]).toMatchObject({ id: "intro", level: 2 });
    expect(sections[1]).toMatchObject({ id: "setup", level: 3 });
    expect(sections[2]).toMatchObject({ id: "api", level: 2 });
    expect(
      sections.every(
        (s) => typeof s.pos === "number" && typeof s.childIndex === "number",
      ),
    ).toBe(true);
    editor.destroy();
  });
});

describe("matchSections", () => {
  it("returns direct matches only (not nested subsection text)", () => {
    const editor = createEditorWithToc(DOC_WITH_SECTIONS);
    const doc = editor.state.doc;
    const matches = matchSections(doc, "intro");
    expect(matches.length).toBe(1);
    expect(matches[0].section.id).toBe("intro");
    expect(matches[0].matches.length).toBeGreaterThan(0);
    editor.destroy();
  });

  it("query matching nothing → empty array", () => {
    const editor = createEditorWithToc(DOC_WITH_SECTIONS);
    const doc = editor.state.doc;
    const matches = matchSections(doc, "xyznonexistent");
    expect(matches).toEqual([]);
    editor.destroy();
  });

  it("empty/whitespace query → empty array", () => {
    const editor = createEditorWithToc(DOC_WITH_SECTIONS);
    const doc = editor.state.doc;
    expect(matchSections(doc, "")).toEqual([]);
    expect(matchSections(doc, "   ")).toEqual([]);
    editor.destroy();
  });
});

describe("filterSections", () => {
  it("OR mode: union of matches", () => {
    const editor = createEditorWithToc(DOC_WITH_SECTIONS);
    const doc = editor.state.doc;
    const result = filterSections(doc, ["intro", "api"], "or");
    expect(result.matchedIds.has("intro")).toBe(true);
    expect(result.matchedIds.has("api")).toBe(true);
    expect(result.totalSections).toBe(3);
    editor.destroy();
  });

  it("AND mode: intersection of matches", () => {
    const editor = createEditorWithToc({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1, "data-toc-id": "t" },
          content: [{ type: "text", text: "T" }],
        },
        {
          type: "heading",
          attrs: { level: 2, "data-toc-id": "foo-bar" },
          content: [{ type: "text", text: "Foo Bar" }],
        },
        {
          type: "heading",
          attrs: { level: 2, "data-toc-id": "baz" },
          content: [{ type: "text", text: "Baz" }],
        },
      ],
    });
    const doc = editor.state.doc;
    const result = filterSections(doc, ["foo", "bar"], "and");
    expect(result.matchedIds.has("foo-bar")).toBe(true);
    expect(result.matchedIds.has("baz")).toBe(false);
    editor.destroy();
  });

  it("hierarchy: matching child → ancestors and descendants included", () => {
    const editor = createEditorWithToc(DOC_WITH_SECTIONS);
    const doc = editor.state.doc;
    const result = filterSections(doc, ["setup"], "or");
    expect(result.matchedIds.has("setup")).toBe(true);
    expect(result.matchedIds.has("intro")).toBe(true);
    expect(result.matchedIds.has("api")).toBe(false);
    editor.destroy();
  });

  it("empty slugs → all section IDs returned", () => {
    const editor = createEditorWithToc(DOC_WITH_SECTIONS);
    const doc = editor.state.doc;
    const result = filterSections(doc, [], "or");
    expect(result.matchedIds.size).toBe(3);
    expect(result.matchedIds.has("intro")).toBe(true);
    expect(result.matchedIds.has("setup")).toBe(true);
    expect(result.matchedIds.has("api")).toBe(true);
    expect(result.totalSections).toBe(3);
    editor.destroy();
  });
});
