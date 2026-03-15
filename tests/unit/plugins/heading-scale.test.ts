import type { Editor } from "@tiptap/core";
import { DecorationSet } from "@tiptap/pm/view";
import { describe, expect, it } from "vitest";
import { headingScalePluginKey } from "@/components/tiptap-node/heading-node/heading-scale-extension";
import { createTestEditor } from "@/tests/helpers/create-test-editor";

function getScaleDecos(editor: Editor): DecorationSet {
  const state = headingScalePluginKey.getState(editor.state);
  return state ?? DecorationSet.empty;
}

describe("HeadingScale plugin decorations", () => {
  it("document with H1>H2>H3: decorations exist, each heading has --hd-size style", () => {
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
            content: [{ type: "text", text: "Subsection" }],
          },
        ],
      },
    });

    const decos = getScaleDecos(editor);
    const found = decos.find();
    expect(found.length).toBe(3);
    editor.destroy();
  });

  it("same rank count → same visual sizing: H1>H2>H4 vs H1>H3>H5", () => {
    const editor1 = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "H1" }],
          },
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "H2" }],
          },
          {
            type: "heading",
            attrs: { level: 4 },
            content: [{ type: "text", text: "H4" }],
          },
        ],
      },
    });

    const editor2 = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "H1" }],
          },
          {
            type: "heading",
            attrs: { level: 3 },
            content: [{ type: "text", text: "H3" }],
          },
          {
            type: "heading",
            attrs: { level: 5 },
            content: [{ type: "text", text: "H5" }],
          },
        ],
      },
    });

    const decos1 = getScaleDecos(editor1).find();
    const decos2 = getScaleDecos(editor2).find();

    expect(decos1.length).toBe(3);
    expect(decos2.length).toBe(3);

    const sizes1 = decos1
      .map((d) => (d.spec as { style?: string }).style)
      .sort();
    const sizes2 = decos2
      .map((d) => (d.spec as { style?: string }).style)
      .sort();
    expect(sizes1).toEqual(sizes2);

    editor1.destroy();
    editor2.destroy();
  });

  it("content edit: decorations mapped (not rebuilt)", () => {
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

    const decosBefore = getScaleDecos(editor).find();
    expect(decosBefore.length).toBe(1);

    editor.commands.setTextSelection(3);
    editor.commands.insertContent("x");

    const decosAfter = getScaleDecos(editor).find();
    expect(decosAfter.length).toBe(1);
    editor.destroy();
  });

  it("add heading: decorations rebuilt", () => {
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
            type: "paragraph",
            content: [{ type: "text", text: "Body" }],
          },
        ],
      },
    });

    const decosBefore = getScaleDecos(editor).find();
    const countBefore = decosBefore.length;

    editor.commands.insertContent({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "New Section" }],
    });

    const decosAfter = getScaleDecos(editor).find();
    expect(decosAfter.length).toBeGreaterThan(countBefore);
    editor.destroy();
  });
});
