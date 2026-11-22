import { afterEach, describe, expect, it } from "bun:test";

import type { Editor, JSONContent } from "@tiptap/core";

import {
  FindController,
  MAX_REPLACE_ALL_GROWTH,
  MAX_REPLACEMENT_LENGTH,
  projectedGrowth,
} from "@/extensions/find/find-controller";
import {
  type FindHit,
  MAX_PAINTED_PER_BLOCK,
  scanHits,
} from "@/extensions/find/find-hits";
import type { FindPainter } from "@/extensions/find/find-painter";

import { createTestEditor } from "../../../helpers/create-test-editor";
import { generateLargeDocument } from "../../../helpers/document-generators";

const loose = { caseSensitive: false, wholeWord: false };

/** Records what the controller asks the painter to show. */
class FakePainter implements FindPainter {
  hits: readonly FindHit[] = [];
  current: FindHit | null = null;
  revealed: FindHit[] = [];
  released: FindHit[] = [];
  destroyed = false;
  paint(
    hits: readonly FindHit[],
    dropped: readonly FindHit[],
    current: FindHit | null,
  ) {
    this.hits = hits;
    this.released.push(...dropped);
    this.current = current;
  }
  reveal(hit: FindHit) {
    this.revealed.push(hit);
  }
  destroy() {
    this.destroyed = true;
  }
}

let editor: Editor | undefined;
let controller: FindController | undefined;
afterEach(() => {
  controller?.destroy();
  editor?.destroy();
  controller = undefined;
  editor = undefined;
});

const heading = (text: string): JSONContent => ({
  type: "heading",
  attrs: { level: 1 },
  content: [{ type: "text", text }],
});
const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

function setup(content: JSONContent[] | JSONContent) {
  editor = createTestEditor({
    content: Array.isArray(content) ? { type: "doc", content } : content,
  });
  const painter = new FakePainter();
  controller = new FindController(editor, painter);
  return { editor, painter, controller };
}

const currentText = (e: Editor, painter: FakePainter) =>
  painter.current &&
  e.state.doc.textBetween(painter.current.from, painter.current.to);

describe("FindController", () => {
  it("counts hits and starts at the first one after the selection", () => {
    const {
      editor: e,
      painter,
      controller: c,
    } = setup([
      heading("Notes"),
      paragraph("one fish"),
      paragraph("two fish"),
      paragraph("red fish"),
    ]);
    e.commands.setTextSelection(17); // inside "two fish"
    c.search("fish", loose);
    expect(c.getSnapshot()).toMatchObject({
      query: "fish",
      total: 3,
      current: 1,
    });
    expect(painter.revealed).toEqual([painter.current as FindHit]);
  });

  it("steps forward and back, wrapping around, without moving the selection", () => {
    const { editor: e, controller: c } = setup([heading("a b a b a")]);
    e.commands.setTextSelection(1);
    const selection = e.state.selection;
    c.search("a", loose);
    expect(c.getSnapshot().current).toBe(0);
    c.step(-1);
    expect(c.getSnapshot().current).toBe(2);
    c.step(1);
    c.step(1);
    expect(c.getSnapshot().current).toBe(1);
    expect(e.state.selection.eq(selection)).toBe(true);
  });

  it("keeps the snapshot object until something shown changes", () => {
    const { controller: c, editor: e } = setup([heading("x"), paragraph("x")]);
    c.search("x", loose);
    const first = c.getSnapshot();
    e.commands.setTextSelection(1);
    e.commands.insertContentAt(e.state.doc.content.size - 1, " y");
    expect(c.getSnapshot()).toBe(first);
  });

  it("follows edits, local or remote, without rescanning untouched blocks", () => {
    const {
      editor: e,
      painter,
      controller: c,
    } = setup(
      generateLargeDocument(1000, { shape: "flat", richContent: false }),
    );
    // UniqueID gives every heading its id on the first edit (one step per
    // heading); the app loads documents that already have them.
    e.commands.insertContentAt(1, " ");
    c.search("section", loose);
    const before = painter.hits;
    expect(before.length).toBeGreaterThan(900);
    const last = before[before.length - 1];
    // Type a hit into the title; then a collaborator's update.
    e.commands.insertContentAt(1, "section ");
    e.view.dispatch(
      e.state.tr
        .insertText(" section", e.state.doc.child(0).nodeSize - 1)
        .setMeta("y-sync$", { isChangeOrigin: true }),
    );
    expect(c.getSnapshot().total).toBe(before.length + 2);
    // Hits outside the edited block are the same objects, mapped in place.
    expect(painter.hits[painter.hits.length - 1]).toBe(last);
    expect(e.state.doc.textBetween(last.from, last.to).toLowerCase()).toBe(
      "section",
    );
  }, 20_000);

  it("recounts a capped list when idle, keeping the hits it finds again", async () => {
    const {
      editor: e,
      painter,
      controller: c,
    } = setup([heading("Title"), paragraph("pin ".repeat(10_050))]);
    c.search("pin", loose);
    expect(c.getSnapshot()).toMatchObject({ total: 10_000, capped: true });
    const kept = painter.hits[5_000];
    e.commands.insertContentAt(1, "x");
    painter.released.length = 0;
    // The recount runs 400 ms after the last edit.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(painter.hits[5_000]).toBe(kept);
    expect(painter.released).toHaveLength(0);
  });

  it("paints a crowded block's hits around the current one, releasing those it leaves", () => {
    const { painter, controller: c } = setup([
      heading("Title"),
      paragraph("pin ".repeat(2_000)),
    ]);
    c.search("pin", loose);
    expect(c.getSnapshot().total).toBe(2_000);
    expect(painter.hits).toHaveLength(MAX_PAINTED_PER_BLOCK);
    const firstWindow = painter.hits;
    for (let i = 0; i < 600; i++) c.step(-1);
    expect(painter.hits).toContain(painter.current as FindHit);
    expect(painter.hits).toHaveLength(MAX_PAINTED_PER_BLOCK);
    // The first window's hits left it, and their ranges are released.
    expect(painter.released).toEqual(expect.arrayContaining([...firstWindow]));
  });

  it("keeps a 25-hit window centred on the current hit as it steps, counting every hit", () => {
    expect(MAX_PAINTED_PER_BLOCK).toBe(25);
    const {
      editor: e,
      painter,
      controller: c,
    } = setup([heading("Title"), paragraph("pin ".repeat(60))]);
    c.search("pin", loose);
    expect(c.getSnapshot().total).toBe(60);
    const hits = scanHits(e.state.doc, /pin/giu);
    const window = () =>
      painter.hits.map((hit) => hits.findIndex((h) => h.from === hit.from));
    // At the first hit the window starts at the block's first hit.
    expect(window()).toEqual([...Array(25).keys()]);
    for (let i = 0; i < 30; i++) c.step(1);
    // Hit 30 is current: 12 before it, 12 after it.
    expect(c.getSnapshot().current).toBe(30);
    expect(window()).toEqual([...Array(25).keys()].map((k) => k + 18));
    // Near the block's end the window stops at its last hit.
    for (let i = 0; i < 28; i++) c.step(1);
    expect(c.getSnapshot().current).toBe(58);
    expect(window()).toEqual([...Array(25).keys()].map((k) => k + 35));
    // Stepping wraps through every hit, painted or not.
    c.step(1);
    c.step(1);
    expect(c.getSnapshot().current).toBe(0);
  });

  it("moves to the next hit when the current one's text is edited away", () => {
    const {
      editor: e,
      painter,
      controller: c,
    } = setup([heading("Notes"), paragraph("cat"), paragraph("cat")]);
    c.search("cat", loose);
    const second = painter.hits[1];
    const first = painter.current as FindHit;
    e.view.dispatch(e.state.tr.delete(first.from, first.from + 1));
    expect(painter.current).toBe(second);
    expect(c.getSnapshot()).toMatchObject({ total: 1, current: 0 });
  });

  it("replaces the current hit and moves past the replacement", () => {
    const { editor: e, painter, controller: c } = setup([heading("a a a")]);
    c.search("a", loose);
    expect(c.replace("aa")).toBe(true);
    expect(e.state.doc.textContent).toBe("aa a a");
    expect(c.getSnapshot()).toMatchObject({ total: 4, current: 2 });
    expect(currentText(e, painter)).toBe("a");
    expect(painter.current?.from).toBe(4);
  });

  it("replaces every hit in one undo step", () => {
    const { editor: e, controller: c } = setup([
      heading("Colour"),
      paragraph("colour and COLOUR"),
    ]);
    c.search("colour", loose);
    expect(c.replaceAll("color")).toEqual({ replaced: 3 });
    expect(e.state.doc.textContent).toBe("colorcolor and color");
    expect(c.getSnapshot().total).toBe(0);
    e.commands.undo();
    expect(e.state.doc.textContent).toBe("Colourcolour and COLOUR");
    expect(c.getSnapshot().total).toBe(3);
  });

  it("refuses a Replace all that would grow the document too much", () => {
    const { editor: e, controller: c } = setup([
      heading("Title"),
      paragraph("a ".repeat(2_000)),
    ]);
    c.search("a", loose);
    const before = e.state.doc;
    // 2,000 hits × 999 more characters each: about 2 MB from one click.
    const long = "b".repeat(MAX_REPLACEMENT_LENGTH);
    expect(c.replaceAll(long)).toEqual({ refused: "too-large" });
    expect(e.state.doc).toBe(before);
    // A replacement that shrinks the text is always allowed, however many hits.
    expect(c.replaceAll("")).toEqual({ replaced: 2_000 });
  });

  it("refuses a replacement longer than the field allows", () => {
    const { editor: e, controller: c } = setup([heading("abc")]);
    c.search("b", loose);
    const tooLong = "x".repeat(MAX_REPLACEMENT_LENGTH + 1);
    expect(c.replace(tooLong)).toBe(false);
    expect(c.replaceAll(tooLong)).toEqual({ refused: "too-large" });
    expect(e.state.doc.textContent).toBe("abc");
  });

  it("projects the growth of a Replace all", () => {
    const hits = [
      { from: 1, to: 2 },
      { from: 5, to: 8 },
    ];
    expect(projectedGrowth(hits, "abcd")).toBe(3 + 1);
    expect(projectedGrowth(hits, "")).toBe(-4);
    // Persian letters are two bytes each in UTF-8, as Yjs stores them.
    expect(projectedGrowth(hits, "کتاب")).toBe(2 * 8 - 4);
    expect(MAX_REPLACE_ALL_GROWTH).toBe(256 * 1024);
  });

  it("keeps the replaced text's marks, not the stored ones", () => {
    const { editor: e, controller: c } = setup([
      heading("Title"),
      {
        type: "paragraph",
        content: [
          { type: "text", text: "plain " },
          { type: "text", text: "bold", marks: [{ type: "bold" }] },
        ],
      },
    ]);
    // Italic toggled at a collapsed caret is a stored mark.
    e.commands.setTextSelection(9);
    e.commands.toggleItalic();
    expect(e.state.storedMarks?.length).toBe(1);
    c.search("plain", loose);
    expect(c.replace("PLAIN")).toBe(true);
    const para = e.state.doc.child(1);
    expect(para.child(0).text).toBe("PLAIN ");
    expect(para.child(0).marks).toEqual([]);
    c.search("bold", loose);
    expect(c.replaceAll("BOLD")).toEqual({ replaced: 1 });
    const last = e.state.doc.child(1).lastChild;
    expect(last?.text).toBe("BOLD");
    expect(last?.marks.map((mark) => mark.type.name)).toEqual(["bold"]);
  });

  it("replacing a block's whole text with nothing keeps the block", () => {
    const { editor: e, controller: c } = setup([
      heading("Title"),
      paragraph("gone"),
      paragraph("stay"),
      paragraph("gone"),
    ]);
    c.search("gone", loose);
    expect(c.replace("")).toBe(true);
    expect(e.state.doc.childCount).toBe(4);
    expect(c.replaceAll("")).toEqual({ replaced: 1 });
    expect(e.state.doc.childCount).toBe(4);
    expect(e.state.doc.textContent).toBe("Titlestay");
  });

  it("replaces with the selection left where it was", () => {
    const { editor: e, controller: c } = setup([heading("one two one")]);
    e.commands.setTextSelection({ from: 5, to: 8 });
    c.search("one", loose);
    c.replace("1");
    const { from, to } = e.state.selection;
    expect(e.state.doc.textBetween(from, to)).toBe("two");
  });

  it("replaces nothing in a read-only document", () => {
    const { editor: e, controller: c } = setup([heading("abc")]);
    c.search("b", loose);
    e.setEditable(false);
    expect(c.replace("x")).toBe(false);
    expect(c.replaceAll("x")).toEqual({ replaced: 0 });
    expect(e.state.doc.textContent).toBe("abc");
  });

  it("selects the current hit only when asked", () => {
    const { editor: e, controller: c } = setup([heading("find me")]);
    c.search("me", loose);
    expect(c.selectCurrent()).toBe(true);
    expect([e.state.selection.from, e.state.selection.to]).toEqual([6, 8]);
    c.search("zzz", loose);
    expect(c.selectCurrent()).toBe(false);
  });

  it("respects match case and whole word", () => {
    const { controller: c } = setup([heading("Cat cat concat")]);
    c.search("cat", { caseSensitive: true, wholeWord: false });
    expect(c.getSnapshot().total).toBe(2);
    c.search("cat", { caseSensitive: false, wholeWord: true });
    expect(c.getSnapshot().total).toBe(2);
    c.search("cat", { caseSensitive: true, wholeWord: true });
    expect(c.getSnapshot()).toMatchObject({
      total: 1,
      caseSensitive: true,
      wholeWord: true,
    });
  });

  it("stops following the editor when destroyed", () => {
    const { editor: e, painter, controller: c } = setup([heading("x")]);
    c.search("x", loose);
    let calls = 0;
    c.subscribe(() => calls++);
    c.destroy();
    controller = undefined;
    e.commands.insertContentAt(1, "x");
    expect(calls).toBe(0);
    expect(painter.destroyed).toBe(true);
  });
});

/**
 * Where the CSS Custom Highlight API is missing (Firefox before 140,
 * Safari before 17.2), Find still works: it counts, and each move to a
 * hit selects it, without focus, so the blurred selection shows it.
 */
describe("FindController without the Highlight API", () => {
  const cssDescriptor = Object.getOwnPropertyDescriptor(globalThis, "CSS");

  afterEach(() => {
    if (cssDescriptor) Object.defineProperty(globalThis, "CSS", cssDescriptor);
    else Reflect.deleteProperty(globalThis, "CSS");
    Reflect.deleteProperty(globalThis, "Highlight");
  });

  function setupWithoutHighlights(content: JSONContent[]) {
    // `Highlight` exists; only the registry is missing.
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: { highlights: undefined },
    });
    Object.assign(globalThis, { Highlight: class {} });
    editor = createTestEditor({ content: { type: "doc", content } });
    controller = new FindController(editor);
    return { editor, controller };
  }

  const selected = (e: Editor) =>
    e.state.doc.textBetween(e.state.selection.from, e.state.selection.to);

  it("counts the hits and selects the current one", () => {
    const { editor: e, controller: c } = setupWithoutHighlights([
      heading("Notes"),
      paragraph("one fish"),
      paragraph("two fish"),
    ]);
    c.search("fish", loose);
    expect(c.getSnapshot()).toMatchObject({ total: 2, current: 0 });
    expect(selected(e)).toBe("fish");
    // "Notes" is 1–6; "one fish" starts at 8.
    expect(e.state.selection.from).toBe(12);
  });

  it("moves the selection with each step, wrapping around", () => {
    const { editor: e, controller: c } = setupWithoutHighlights([
      heading("a b a"),
    ]);
    e.commands.setTextSelection(1);
    c.search("a", loose);
    expect(e.state.selection.from).toBe(1);
    c.step(1);
    expect(c.getSnapshot().current).toBe(1);
    expect(e.state.selection.from).toBe(5);
    expect(selected(e)).toBe("a");
    c.step(1);
    expect(e.state.selection.from).toBe(1);
  });

  it("never takes focus from the find field", () => {
    const field = document.createElement("input");
    document.body.append(field);
    const { controller: c } = setupWithoutHighlights([heading("fish fish")]);
    field.focus();
    c.search("fish", loose);
    c.step(1);
    expect(document.activeElement).toBe(field);
    field.remove();
  });

  it("leaves the caret alone when the document changes", () => {
    const { editor: e, controller: c } = setupWithoutHighlights([
      heading("fish"),
      paragraph("typing here"),
    ]);
    c.search("fish", loose);
    const caret = e.state.doc.content.size - 2;
    e.commands.setTextSelection(caret);
    e.commands.insertContent("x");
    expect(e.state.selection.from).toBe(caret + 1);
    expect(c.getSnapshot().total).toBe(1);
  });
});
