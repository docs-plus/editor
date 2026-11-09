import type { Extension } from "@tiptap/core";
import {
  type TableOfContentData,
  TableOfContents,
} from "@tiptap/extension-table-of-contents";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyActiveState,
  collectTocItems,
  FastTableOfContents,
} from "@/extensions/table-of-contents";

import {
  createTestEditor,
  DEFAULT_EXTENSIONS,
} from "../../helpers/create-test-editor";

const heading = (level: number, text: string, id?: string) => ({
  type: "heading",
  attrs: { level, ...(id ? { "data-toc-id": id, id } : {}) },
  content: [{ type: "text", text }],
});

let editor: ReturnType<typeof createTestEditor> | undefined;
afterEach(() => editor?.destroy());

describe("collectTocItems", () => {
  it("lists non-empty headings with levels and positions, skipping body text", () => {
    editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          heading(1, "Title"),
          { type: "paragraph", content: [{ type: "text", text: "Body" }] },
          heading(2, "Section"),
          { type: "heading", attrs: { level: 3 } },
          heading(3, "Sub"),
        ],
      },
    });
    const items = collectTocItems(editor, { anchorTypes: ["heading"] });
    expect(items.map((item) => [item.textContent, item.originalLevel])).toEqual(
      [
        ["Title", 1],
        ["Section", 2],
        ["Sub", 3],
      ],
    );
    expect(items.every((item) => item.dom instanceof HTMLElement)).toBe(true);
    expect(items[1]?.pos).toBeGreaterThan(items[0]?.pos ?? 0);
  });
});

describe("applyActiveState", () => {
  const fakeItems = (tops: number[]) =>
    tops.map((offsetTop, index) => ({
      id: `h${index}`,
      dom: { offsetTop },
    })) as unknown as TableOfContentData;

  it("marks the last heading above the scroll position active", () => {
    const { items, key } = applyActiveState(fakeItems([0, 400, 900]), 500);
    expect(items.map((item) => item.isActive)).toEqual([false, true, false]);
    expect(items.map((item) => item.isScrolledOver)).toEqual([
      true,
      true,
      false,
    ]);
    expect(key).toBe("h1:1");
  });

  it("has a stable key so scroll handlers can skip unchanged states", () => {
    const list = fakeItems([0, 400, 900]);
    expect(applyActiveState(list, 450).key).toBe(
      applyActiveState(list, 899).key,
    );
    expect(applyActiveState(list, -1).key).toBe("");
  });
});

const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

function fastTocEditor(
  content: object,
  onUpdate?: (items: TableOfContentData) => void,
) {
  return createTestEditor({
    content,
    extensions: [
      ...DEFAULT_EXTENSIONS.filter((ext) => ext !== TableOfContents),
      FastTableOfContents.configure({ onUpdate }),
    ] as Extension[],
  });
}

const tocIds = (instance: ReturnType<typeof createTestEditor>) => {
  const ids: unknown[] = [];
  instance.state.doc.forEach((node) => {
    if (node.type.name === "heading") ids.push(node.attrs["data-toc-id"]);
  });
  return ids;
};

describe("TOC ids", () => {
  it("gives new and duplicated headings fresh ids, keeping the first", () => {
    editor = fastTocEditor({
      type: "doc",
      content: [heading(1, "Title", "t"), paragraph("Body")],
    });
    editor.commands.insertContentAt(editor.state.doc.content.size, [
      heading(2, "Copy", "t"),
      heading(2, "Fresh"),
    ]);
    const ids = tocIds(editor);
    expect(ids[0]).toBe("t");
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => typeof id === "string" && id.length > 0)).toBe(
      true,
    );
  });

  it("gives the second half of a split heading its own id", () => {
    editor = fastTocEditor({
      type: "doc",
      content: [heading(1, "Title", "t"), heading(2, "Left Right", "lr")],
    });
    // Inside "Left Right", between the words.
    editor.chain().setTextSelection(13).splitBlock().run();
    const ids = tocIds(editor);
    expect(ids).toHaveLength(3);
    expect(ids[1]).toBe("lr");
    expect(new Set(ids).size).toBe(3);
  });

  it("does not touch headings when body text changes", () => {
    editor = fastTocEditor({
      type: "doc",
      content: [heading(1, "Title", "t"), paragraph("Body")],
    });
    const transactions: number[] = [];
    editor.on("transaction", ({ transaction }) =>
      transactions.push(transaction.steps.length),
    );
    editor.commands.insertContentAt(9, "more ");
    expect(transactions).toEqual([1]);
    expect(tocIds(editor)).toEqual(["t"]);
  });
});
