import { describe, expect, it } from "vitest";

import { moveSection } from "@/lib/editor-utils";
import { createTestEditor } from "@/tests/helpers/create-test-editor";

type BlockNode = { type: string; attrs?: object; content?: object[] };

function makeDoc(
  sections: {
    level: number;
    title: string;
    body?: string;
    blocks?: BlockNode[];
  }[],
) {
  return {
    type: "doc" as const,
    content: sections.flatMap((s) => {
      const nodes: BlockNode[] = [
        {
          type: "heading",
          attrs: { level: s.level },
          content: [{ type: "text", text: s.title }],
        },
      ];
      if (s.blocks) {
        nodes.push(...s.blocks);
      } else if (s.body) {
        nodes.push({
          type: "paragraph",
          content: [{ type: "text", text: s.body }],
        });
      }
      return nodes;
    }),
  };
}

function getHeadings(editor: ReturnType<typeof createTestEditor>) {
  const headings: { level: number; text: string; pos: number }[] = [];
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === "heading") {
      headings.push({
        level: node.attrs.level as number,
        text: node.textContent,
        pos: offset,
      });
    }
  });
  return headings;
}

describe("moveSection", () => {
  it("moves a section down (H2 past another H2)", () => {
    const editor = createTestEditor({
      content: makeDoc([
        { level: 1, title: "Title" },
        { level: 2, title: "Section A", body: "Content A" },
        { level: 2, title: "Section B", body: "Content B" },
      ]),
    });

    const headings = getHeadings(editor);
    const sectionA = headings.find((h) => h.text === "Section A")!;
    const sectionB = headings.find((h) => h.text === "Section B")!;

    const sectionAEnd = sectionB.pos;

    moveSection(
      editor.view,
      sectionA.pos,
      sectionAEnd,
      editor.state.doc.content.size,
    );

    const after = getHeadings(editor);
    expect(after[1].text).toBe("Section B");
    expect(after[2].text).toBe("Section A");
    editor.destroy();
  });

  it("moves a section up (H2 before another H2)", () => {
    const editor = createTestEditor({
      content: makeDoc([
        { level: 1, title: "Title" },
        { level: 2, title: "Section A", body: "Content A" },
        { level: 2, title: "Section B", body: "Content B" },
      ]),
    });

    const headings = getHeadings(editor);
    const sectionA = headings.find((h) => h.text === "Section A")!;
    const sectionB = headings.find((h) => h.text === "Section B")!;

    moveSection(
      editor.view,
      sectionB.pos,
      editor.state.doc.content.size,
      sectionA.pos,
    );

    const after = getHeadings(editor);
    expect(after[1].text).toBe("Section B");
    expect(after[2].text).toBe("Section A");
    editor.destroy();
  });

  it("changes heading level without moving position", () => {
    const editor = createTestEditor({
      content: makeDoc([
        { level: 1, title: "Title" },
        { level: 2, title: "Section A", body: "Content" },
      ]),
    });

    const headings = getHeadings(editor);
    const section = headings.find((h) => h.text === "Section A")!;
    const sectionEnd = editor.state.doc.content.size;

    moveSection(editor.view, section.pos, sectionEnd, section.pos, 3);

    const after = getHeadings(editor);
    expect(after[1].level).toBe(3);
    expect(after[1].text).toBe("Section A");
    editor.destroy();
  });

  it("moves and changes level in a single transaction", () => {
    const editor = createTestEditor({
      content: makeDoc([
        { level: 1, title: "Title" },
        { level: 2, title: "Section A", body: "Content A" },
        { level: 2, title: "Section B", body: "Content B" },
      ]),
    });

    const headings = getHeadings(editor);
    const sectionA = headings.find((h) => h.text === "Section A")!;
    const sectionB = headings.find((h) => h.text === "Section B")!;

    moveSection(
      editor.view,
      sectionA.pos,
      sectionB.pos,
      editor.state.doc.content.size,
      3,
    );

    const after = getHeadings(editor);
    expect(after[1].text).toBe("Section B");
    expect(after[2].text).toBe("Section A");
    expect(after[2].level).toBe(3);
    editor.destroy();
  });

  it("no-op when target equals sectionFrom", () => {
    const editor = createTestEditor({
      content: makeDoc([
        { level: 1, title: "Title" },
        { level: 2, title: "Section A", body: "Content" },
      ]),
    });

    const headings = getHeadings(editor);
    const section = headings.find((h) => h.text === "Section A")!;
    const docBefore = editor.state.doc.toJSON();

    moveSection(
      editor.view,
      section.pos,
      editor.state.doc.content.size,
      section.pos,
    );

    expect(editor.state.doc.toJSON()).toEqual(docBefore);
    editor.destroy();
  });

  it("no-op when target is inside section range", () => {
    const editor = createTestEditor({
      content: makeDoc([
        { level: 1, title: "Title" },
        { level: 2, title: "Section A", body: "Content A" },
        { level: 2, title: "Section B" },
      ]),
    });

    const headings = getHeadings(editor);
    const sectionA = headings.find((h) => h.text === "Section A")!;
    const sectionB = headings.find((h) => h.text === "Section B")!;
    const docBefore = editor.state.doc.toJSON();

    moveSection(editor.view, sectionA.pos, sectionB.pos, sectionA.pos + 2);

    expect(editor.state.doc.toJSON()).toEqual(docBefore);
    editor.destroy();
  });

  it("is a single undo step", () => {
    const editor = createTestEditor({
      content: makeDoc([
        { level: 1, title: "Title" },
        { level: 2, title: "Section A", body: "Content A" },
        { level: 2, title: "Section B", body: "Content B" },
      ]),
    });

    const headings = getHeadings(editor);
    const sectionA = headings.find((h) => h.text === "Section A")!;
    const sectionB = headings.find((h) => h.text === "Section B")!;

    moveSection(
      editor.view,
      sectionA.pos,
      sectionB.pos,
      editor.state.doc.content.size,
      4,
    );

    const afterMove = getHeadings(editor);
    expect(afterMove[1].text).toBe("Section B");
    expect(afterMove[2].text).toBe("Section A");
    expect(afterMove[2].level).toBe(4);

    editor.commands.undo();

    const afterUndo = getHeadings(editor);
    const named = afterUndo.filter((h) => h.text.length > 0);
    expect(named[0].text).toBe("Title");
    expect(named[1].text).toBe("Section A");
    expect(named[1].level).toBe(2);
    expect(named[2].text).toBe("Section B");
    expect(named[2].level).toBe(2);
    editor.destroy();
  });

  it("moves a heading-only section (no body content)", () => {
    const editor = createTestEditor({
      content: makeDoc([
        { level: 1, title: "Title" },
        { level: 2, title: "Section A" },
        { level: 2, title: "Section B", body: "Content B" },
      ]),
    });

    const headings = getHeadings(editor);
    const sectionA = headings.find((h) => h.text === "Section A")!;
    const sectionB = headings.find((h) => h.text === "Section B")!;

    moveSection(
      editor.view,
      sectionA.pos,
      sectionB.pos,
      editor.state.doc.content.size,
    );

    const after = getHeadings(editor);
    expect(after[1].text).toBe("Section B");
    expect(after[2].text).toBe("Section A");
    editor.destroy();
  });

  it("moves a section containing complex block types", () => {
    const editor = createTestEditor({
      content: makeDoc([
        { level: 1, title: "Title" },
        {
          level: 2,
          title: "Section A",
          blocks: [
            {
              type: "bulletList",
              content: [
                {
                  type: "listItem",
                  content: [
                    {
                      type: "paragraph",
                      content: [{ type: "text", text: "Item 1" }],
                    },
                  ],
                },
              ],
            },
            {
              type: "codeBlock",
              attrs: { language: "js" },
              content: [{ type: "text", text: "const x = 1;" }],
            },
            {
              type: "blockquote",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "A quote" }],
                },
              ],
            },
          ],
        },
        { level: 2, title: "Section B", body: "Content B" },
      ]),
    });

    const headings = getHeadings(editor);
    const sectionA = headings.find((h) => h.text === "Section A")!;
    const sectionB = headings.find((h) => h.text === "Section B")!;

    moveSection(
      editor.view,
      sectionA.pos,
      sectionB.pos,
      editor.state.doc.content.size,
    );

    const after = getHeadings(editor);
    expect(after[1].text).toBe("Section B");
    expect(after[2].text).toBe("Section A");

    let foundList = false;
    let foundCode = false;
    let foundQuote = false;
    editor.state.doc.forEach((node) => {
      if (node.type.name === "bulletList") foundList = true;
      if (node.type.name === "codeBlock") foundCode = true;
      if (node.type.name === "blockquote") foundQuote = true;
    });
    expect(foundList).toBe(true);
    expect(foundCode).toBe(true);
    expect(foundQuote).toBe(true);
    editor.destroy();
  });

  it("moves a section to just after the title (doc start)", () => {
    const editor = createTestEditor({
      content: makeDoc([
        { level: 1, title: "Title" },
        { level: 2, title: "Section A", body: "Content A" },
        { level: 2, title: "Section B", body: "Content B" },
        { level: 2, title: "Section C", body: "Content C" },
      ]),
    });

    const headings = getHeadings(editor);
    const title = headings.find((h) => h.text === "Title")!;
    const sectionC = headings.find((h) => h.text === "Section C")!;
    const titleEnd = title.pos + editor.state.doc.child(0).nodeSize;

    moveSection(
      editor.view,
      sectionC.pos,
      editor.state.doc.content.size,
      titleEnd,
    );

    const after = getHeadings(editor);
    expect(after[0].text).toBe("Title");
    expect(after[1].text).toBe("Section C");
    expect(after[2].text).toBe("Section A");
    expect(after[3].text).toBe("Section B");
    editor.destroy();
  });
});
