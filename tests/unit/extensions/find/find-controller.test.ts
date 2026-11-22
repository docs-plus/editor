import { afterEach, describe, expect, it } from "bun:test";

import type { Editor, JSONContent } from "@tiptap/core";

import { FindController } from "@/extensions/find/find-controller";
import type { FindHit } from "@/extensions/find/find-hits";
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
    expect(c.replaceAll("color")).toBe(3);
    expect(e.state.doc.textContent).toBe("colorcolor and color");
    expect(c.getSnapshot().total).toBe(0);
    e.commands.undo();
    expect(e.state.doc.textContent).toBe("Colourcolour and COLOUR");
    expect(c.getSnapshot().total).toBe(3);
  });

  it("replaces nothing in a read-only document", () => {
    const { editor: e, controller: c } = setup([heading("abc")]);
    c.search("b", loose);
    e.setEditable(false);
    expect(c.replace("x")).toBe(false);
    expect(c.replaceAll("x")).toBe(0);
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
