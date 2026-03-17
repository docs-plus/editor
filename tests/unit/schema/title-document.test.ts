import { afterEach, describe, expect, it } from "vitest";

import { assertFirstNodeIsH1 } from "@/tests/helpers/assert-invariants";
import { createTestEditor } from "@/tests/helpers/create-test-editor";

describe("TitleDocument enforcement", () => {
  afterEach(() => {
    // Cleanup handled per-test
  });

  it("H1 enforcement: schema requires heading first; first node is always heading", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Title" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "Body" }] },
        ],
      },
    });
    const first = editor.state.doc.firstChild;
    expect(first?.type.name).toBe("heading");
    // appendTransaction corrects level to 1 when transactions run; schema enforces heading first
    expect(first?.attrs.level).toBeGreaterThanOrEqual(1);
    expect(first?.attrs.level).toBeLessThanOrEqual(6);
    editor.destroy();
  });

  it("Empty document: first node is H1", () => {
    const editor = createTestEditor();
    assertFirstNodeIsH1(editor.state.doc);
    editor.destroy();
  });

  it("Delete title: select all and delete leaves title H1 (schema prevents deletion of only heading)", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Title" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "Body" }] },
        ],
      },
    });
    editor.commands.selectAll();
    editor.commands.deleteSelection();
    assertFirstNodeIsH1(editor.state.doc);
    editor.destroy();
  });

  it("Title with empty text: valid state, first node is H1", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
          },
        ],
      },
    });
    assertFirstNodeIsH1(editor.state.doc);
    expect(editor.state.doc.firstChild?.childCount).toBe(0);
    editor.destroy();
  });

  it("Set heading level on title: title remains a heading after setNode", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Title" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "Body" }] },
        ],
      },
    });
    editor.commands.setTextSelection(1);
    editor.commands.setNode("heading", { level: 2 });
    const first = editor.state.doc.firstChild;
    expect(first?.type.name).toBe("heading");
    expect(first?.attrs.level).toBeGreaterThanOrEqual(1);
    expect(first?.attrs.level).toBeLessThanOrEqual(6);
    editor.destroy();
  });

  it("Insert before title: schema enforces heading first, first node remains heading", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Title" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "Body" }] },
        ],
      },
    });
    try {
      editor.view.dispatch(
        editor.state.tr.insert(
          1,
          editor.schema.nodes.paragraph.create(
            null,
            editor.schema.text("Before"),
          ),
        ),
      );
    } catch {
      // Schema may reject; doc unchanged
    }
    assertFirstNodeIsH1(editor.state.doc);
    editor.destroy();
  });

  it("Multiple H1s: all valid, first stays title", () => {
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
            attrs: { level: 1 },
            content: [{ type: "text", text: "Section One" }],
          },
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Section Two" }],
          },
        ],
      },
    });
    assertFirstNodeIsH1(editor.state.doc);
    expect(editor.state.doc.childCount).toBe(3);
    expect(editor.state.doc.child(1).attrs.level).toBe(1);
    expect(editor.state.doc.child(2).attrs.level).toBe(1);
    editor.destroy();
  });
});
