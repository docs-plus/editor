import { afterEach, describe, expect, it } from "bun:test";

import type { Editor } from "@tiptap/core";

import { countText, countWords } from "@/lib/word-count";
import { createTestEditor } from "@/tests/helpers/create-test-editor";

let editor: Editor | undefined;

afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

const doc = (...blocks: object[]) => {
  editor = createTestEditor({
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "My title" }],
        },
        ...blocks,
      ],
    },
  });
  return editor.state.doc;
};

const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

describe("countText", () => {
  it("counts words, characters and characters without spaces", () => {
    expect(countText("Hello, wide world.")).toEqual({
      words: 3,
      characters: 18,
      charactersWithoutSpaces: 16,
    });
  });

  it("counts nothing in empty or blank text", () => {
    expect(countText("")).toEqual({
      words: 0,
      characters: 0,
      charactersWithoutSpaces: 0,
    });
    expect(countText("  \n ").words).toBe(0);
  });

  it("keeps a Persian word with a ZWNJ as one word and one run of letters", () => {
    // می‌خواهم: the ZWNJ joins the parts of one word.
    const result = countText("من می‌خواهم");
    expect(result.words).toBe(2);
    // The ZWNJ extends the letter before it, so it is not a character.
    expect(result.charactersWithoutSpaces).toBe("منمیخواهم".length);
  });

  it("counts an emoji sequence as one character", () => {
    expect(countText("👩‍💻").characters).toBe(1);
  });

  it("never counts punctuation alone as a word", () => {
    expect(countText("— … !").words).toBe(0);
  });
});

describe("countWords", () => {
  it("counts the whole document, title included", () => {
    const counts = countWords(doc(paragraph("One two"), paragraph("three")));
    expect(counts.words).toBe(5);
  });

  it("never joins words across blocks or counts the breaks", () => {
    const counts = countWords(doc(paragraph("end"), paragraph("start")));
    // "title" and "end" are separate words, and the block breaks between
    // them are not characters.
    expect(counts.words).toBe(4);
    expect(counts.characters).toBe("My title".length + 3 + 5);
  });

  it("counts only the selection when a range is given", () => {
    const state = doc(paragraph("alpha beta gamma"));
    const start = state.content.firstChild?.nodeSize ?? 0;
    // Inside the paragraph: "beta gamma".
    const from = start + 1 + "alpha ".length;
    const to = start + 1 + "alpha beta gamma".length;
    expect(countWords(state, { from, to })).toEqual({
      words: 2,
      characters: 10,
      charactersWithoutSpaces: 9,
    });
  });

  it("counts the text of lists and tables", () => {
    const counts = countWords(
      doc({
        type: "bulletList",
        content: [
          { type: "listItem", content: [paragraph("first item")] },
          { type: "listItem", content: [paragraph("second")] },
        ],
      }),
    );
    expect(counts.words).toBe(2 + 3);
  });
});
