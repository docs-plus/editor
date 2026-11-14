import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { Editor, JSONContent } from "@tiptap/core";

import { headingFoldPluginKey } from "@/extensions/heading-fold";
import { goToHeading, scrollBlockIntoView } from "@/lib/heading-navigation";
import { createTestEditor } from "@/tests/helpers/create-test-editor";

type ScrollCall = ScrollIntoViewOptions | boolean | undefined;

let scrolls: { el: Element; options: ScrollCall }[];
let frames: FrameRequestCallback[];
let reducedMotion: boolean;
const originalScroll = Element.prototype.scrollIntoView;
const originalFrame = window.requestAnimationFrame;
const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  scrolls = [];
  frames = [];
  reducedMotion = false;
  Element.prototype.scrollIntoView = function (options?: ScrollCall) {
    scrolls.push({ el: this, options });
  };
  window.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  window.matchMedia = ((query: string) => ({
    matches: query.includes("reduce") && reducedMotion,
  })) as typeof window.matchMedia;
});
afterEach(() => {
  Element.prototype.scrollIntoView = originalScroll;
  window.requestAnimationFrame = originalFrame;
  window.matchMedia = originalMatchMedia;
});

const runFrames = () => {
  for (const frame of frames.splice(0)) frame(0);
};

describe("scrollBlockIntoView", () => {
  let block: HTMLElement;
  beforeEach(() => {
    block = document.createElement("h2");
    document.body.append(block);
  });
  afterEach(() => block.remove());

  it("scrolls smoothly, then settles once without animation when the scroll ends", () => {
    scrollBlockIntoView(block, "start");
    expect(scrolls).toEqual([
      { el: block, options: { behavior: "smooth", block: "start" } },
    ]);
    document.body.dispatchEvent(new Event("scrollend"));
    document.body.dispatchEvent(new Event("scrollend"));
    expect(scrolls.slice(1)).toEqual([
      { el: block, options: { block: "start" } },
    ]);
  });

  it("ignores a scroll that ends in a container without the block", () => {
    const other = document.createElement("div");
    document.body.append(other);
    scrollBlockIntoView(block, "center");
    other.dispatchEvent(new Event("scrollend"));
    expect(scrolls).toHaveLength(1);
    other.remove();
  });

  it.each(["wheel", "touchstart", "keydown", "pointerdown"])(
    "drops the settle pass when the user takes over (%s)",
    (type) => {
      scrollBlockIntoView(block, "center");
      document.dispatchEvent(new Event(type));
      document.body.dispatchEvent(new Event("scrollend"));
      expect(scrolls).toHaveLength(1);
    },
  );

  it("does not animate under reduced motion", () => {
    reducedMotion = true;
    scrollBlockIntoView(block, "start");
    expect(scrolls[0].options).toEqual({ behavior: "auto", block: "start" });
  });
});

const heading = (text: string, id: string, level: number): JSONContent => ({
  type: "heading",
  attrs: { level, "data-toc-id": id, id },
  content: [{ type: "text", text }],
});
const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

describe("goToHeading", () => {
  let editor: Editor;
  beforeEach(() => {
    editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          heading("Title", "title", 1),
          heading("Outer", "outer", 2),
          paragraph("outer body"),
          heading("Inner", "inner", 3),
          paragraph("inner body"),
        ],
      },
    });
  });
  afterEach(() => editor.destroy());

  const innerPos = () => {
    let found = -1;
    editor.state.doc.forEach((node, offset) => {
      if (node.attrs["data-toc-id"] === "inner") found = offset;
    });
    return found;
  };

  it("unfolds the ancestors, puts the caret at the end of the heading, then scrolls it next frame", () => {
    editor.view.dispatch(
      editor.state.tr.setMeta(headingFoldPluginKey, {
        type: "set",
        ids: new Set(["outer"]),
      }),
    );
    expect(goToHeading(editor, "inner", "start")).toBe(true);

    const pos = innerPos();
    const end = pos + (editor.state.doc.nodeAt(pos)?.nodeSize ?? 0) - 1;
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.head).toBe(end);
    expect(headingFoldPluginKey.getState(editor.state)?.foldedIds.size).toBe(0);
    expect(scrolls).toHaveLength(0);

    runFrames();
    const target = editor.view.nodeDOM(pos);
    expect(scrolls.some((s) => s.el === target)).toBe(true);
    expect(scrolls.find((s) => s.el === target)?.options).toEqual({
      behavior: "smooth",
      block: "start",
    });
  });

  it("looks the heading up again when the frame runs", () => {
    goToHeading(editor, "inner", "center");
    const before = innerPos();
    const afterTitle = editor.state.doc.firstChild?.nodeSize ?? 0;
    editor.commands.insertContentAt(afterTitle, paragraph("pushed down"));
    expect(innerPos()).toBeGreaterThan(before);
    runFrames();
    const target = editor.view.nodeDOM(innerPos());
    expect(scrolls.find((s) => s.el === target)?.options).toEqual({
      behavior: "smooth",
      block: "center",
    });
  });

  it("returns false and moves nothing for a heading that is gone", () => {
    const before = editor.state.selection.head;
    expect(goToHeading(editor, "missing", "start")).toBe(false);
    expect(editor.state.selection.head).toBe(before);
    runFrames();
    expect(scrolls).toHaveLength(0);
  });
});
