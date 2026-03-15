import type { Transaction } from "@tiptap/pm/state";
import { describe, expect, it } from "vitest";
import { canMapDecorations } from "@/components/tiptap-node/heading-node/helpers/can-map-decorations";
import { createTestEditor } from "@/tests/helpers/create-test-editor";

describe("canMapDecorations", () => {
  it("content-only edit (insert text in paragraph) → returns true", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Title" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "Hi" }] },
        ],
      },
    });
    const oldDoc = editor.state.doc;
    let lastTr: Transaction | undefined;
    editor.on("transaction", ({ transaction }) => {
      lastTr = transaction;
    });
    editor.commands.insertContent("hello");
    expect(lastTr).toBeDefined();
    expect(canMapDecorations(lastTr!, oldDoc)).toBe(true);
    editor.destroy();
  });

  it("insert new heading → returns false", () => {
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
    const oldDoc = editor.state.doc;
    let lastTr: Transaction | undefined;
    editor.on("transaction", ({ transaction }) => {
      lastTr = transaction;
    });
    editor.commands.insertContent({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "New Section" }],
    });
    expect(lastTr).toBeDefined();
    expect(canMapDecorations(lastTr!, oldDoc)).toBe(false);
    editor.destroy();
  });

  it("delete heading → returns false", () => {
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
          { type: "paragraph", content: [{ type: "text", text: "Body" }] },
        ],
      },
    });
    const oldDoc = editor.state.doc;
    let lastTr: Transaction | undefined;
    editor.on("transaction", ({ transaction }) => {
      lastTr = transaction;
    });
    editor.chain().focus().setTextSelection(1).deleteSelection().run();
    expect(lastTr).toBeDefined();
    expect(canMapDecorations(lastTr!, oldDoc)).toBe(false);
    editor.destroy();
  });

  it("empty transaction (no steps) → returns false", () => {
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
    const oldDoc = editor.state.doc;
    const tr = editor.state.tr;
    expect(tr.steps.length).toBe(0);
    expect(canMapDecorations(tr, oldDoc)).toBe(false);
    editor.destroy();
  });
});
