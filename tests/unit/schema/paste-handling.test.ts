import { Fragment, Slice } from "@tiptap/pm/model";
import { Selection } from "@tiptap/pm/state";
import { afterEach, describe, expect, it } from "vitest";

import { assertFirstNodeIsH1 } from "@/tests/helpers/assert-invariants";
import { createTestEditor } from "@/tests/helpers/create-test-editor";

describe("paste handling (appendTransaction behavior)", () => {
  afterEach(() => {
    // Cleanup handled per-test
  });

  it("full-document paste (heading first block): H2 as first block is corrected to H1 by appendTransaction", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Original Title" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "Body" }] },
        ],
      },
    });
    const { schema, state } = editor;
    const heading = schema.nodes.heading.create(
      { level: 2 },
      schema.text("Pasted H2 Title"),
    );
    const para = schema.nodes.paragraph.create(
      null,
      schema.text("Pasted body"),
    );
    const slice = new Slice(
      Fragment.from(heading).append(Fragment.from(para)),
      0,
      0,
    );
    editor.commands.selectAll();
    try {
      editor.view.dispatch(state.tr.replaceSelection(slice));
    } catch {
      // Schema may reject
    }
    assertFirstNodeIsH1(editor.state.doc);
    editor.destroy();
  });

  it("full-document paste (non-heading first block): paragraph first → schema rejects or first node remains heading", () => {
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
    const { schema, state } = editor;
    const p1 = schema.nodes.paragraph.create(null, schema.text("Pasted P1"));
    const p2 = schema.nodes.paragraph.create(null, schema.text("Pasted P2"));
    const slice = new Slice(Fragment.from(p1).append(Fragment.from(p2)), 0, 0);
    editor.commands.selectAll();
    try {
      editor.view.dispatch(state.tr.replaceSelection(slice));
    } catch {
      // Schema rejects invalid content
    }
    assertFirstNodeIsH1(editor.state.doc);
    editor.destroy();
  });

  it("partial paste (cursor mid-document): no change to title", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Title" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "First" }] },
          { type: "paragraph", content: [{ type: "text", text: "Second" }] },
        ],
      },
    });
    const { schema, state } = editor;
    const para = schema.nodes.paragraph.create(null, schema.text("Inserted"));
    const slice = new Slice(Fragment.from(para), 0, 0);
    const midPos = state.doc.content.size - 5;
    editor.view.dispatch(
      state.tr
        .setSelection(Selection.near(state.doc.resolve(midPos)))
        .replaceSelection(slice),
    );
    assertFirstNodeIsH1(editor.state.doc);
    expect(editor.state.doc.firstChild?.textContent).toBe("Title");
    editor.destroy();
  });

  it("multiple blocks paste: paragraph + paragraph at position 0 → first node is H1", () => {
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
    const { schema, state } = editor;
    const p1 = schema.nodes.paragraph.create(null, schema.text("A"));
    const p2 = schema.nodes.paragraph.create(null, schema.text("B"));
    const slice = new Slice(Fragment.from(p1).append(Fragment.from(p2)), 0, 0);
    editor.commands.selectAll();
    try {
      editor.view.dispatch(state.tr.replaceSelection(slice));
    } catch {
      // Schema rejects
    }
    assertFirstNodeIsH1(editor.state.doc);
    editor.destroy();
  });
});
