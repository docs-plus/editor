import type { TableOfContentData } from "@tiptap/extension-table-of-contents";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyActiveState,
  collectTocItems,
} from "@/extensions/table-of-contents";

import { createTestEditor } from "../../helpers/create-test-editor";

const heading = (level: number, text: string) => ({
  type: "heading",
  attrs: { level },
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
