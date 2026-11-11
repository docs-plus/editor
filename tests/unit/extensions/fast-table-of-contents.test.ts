import { afterEach, describe, expect, it, vi } from "bun:test";

import type { Extension } from "@tiptap/core";
import {
  type TableOfContentData,
  TableOfContents,
} from "@tiptap/extension-table-of-contents";

import {
  applyActiveState,
  collectTocItems,
  FastTableOfContents,
  findTocAnchor,
  sameTocItems,
} from "@/extensions/table-of-contents";
import { TOC_REBUILD_INTERVAL_MS } from "@/extensions/table-of-contents/fast-table-of-contents";

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

describe("sameTocItems", () => {
  const items = (texts: string[], active = -1) =>
    texts.map((textContent, index) => ({
      id: `h${index}`,
      textContent,
      level: 1,
      originalLevel: 1,
      itemIndex: index + 1,
      isActive: index === active,
      isScrolledOver: index <= active,
      pos: index * 10,
    })) as unknown as TableOfContentData;

  it("ignores positions, which move with every edit above a heading", () => {
    const moved = items(["A", "B"]).map((item) => ({ ...item, pos: 999 }));
    expect(sameTocItems(items(["A", "B"]), moved)).toBe(true);
  });

  it("sees text, count and active-state changes", () => {
    expect(sameTocItems(items(["A", "B"]), items(["A", "Bc"]))).toBe(false);
    expect(sameTocItems(items(["A", "B"]), items(["A"]))).toBe(false);
    expect(sameTocItems(items(["A", "B"]), items(["A", "B"], 1))).toBe(false);
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

describe("findTocAnchor", () => {
  it("finds a heading by TOC id at its current position", () => {
    editor = fastTocEditor({
      type: "doc",
      content: [heading(1, "Title", "t"), heading(2, "Two", "two")],
    });
    editor.commands.insertContentAt(1, "New ");
    const found = findTocAnchor(editor.state.doc, "two");
    expect(found?.node.textContent).toBe("Two");
    expect(editor.state.doc.nodeAt(found?.pos ?? -1)).toBe(found?.node ?? null);
    expect(findTocAnchor(editor.state.doc, "missing")).toBeNull();
  });
});

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

describe("FastTableOfContents updates", () => {
  afterEach(() => vi.useRealTimers());

  it("coalesces rebuilds and reports only outline changes", () => {
    vi.useFakeTimers();
    const onUpdate = vi.fn();
    editor = fastTocEditor(
      {
        type: "doc",
        content: [heading(1, "Title", "t"), paragraph("Body")],
      },
      onUpdate,
    );
    // `onCreate` (the first build) runs on a timer after construction.
    vi.advanceTimersByTime(0);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    onUpdate.mockClear();

    for (let i = 0; i < 5; i++) editor.commands.insertContentAt(9, "x");
    vi.advanceTimersByTime(TOC_REBUILD_INTERVAL_MS);
    expect(onUpdate).not.toHaveBeenCalled();

    editor.commands.insertContentAt(2, "y");
    editor.commands.insertContentAt(2, "z");
    expect(onUpdate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(TOC_REBUILD_INTERVAL_MS);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0][0].textContent).toBe("Tzyitle");

    // After a quiet interval, the next change rebuilds right away.
    vi.advanceTimersByTime(TOC_REBUILD_INTERVAL_MS);
    editor.commands.insertContentAt(2, "w");
    vi.advanceTimersByTime(0);
    expect(onUpdate).toHaveBeenCalledTimes(2);
  });
});
