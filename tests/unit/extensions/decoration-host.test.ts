import { afterEach, describe, expect, it } from "bun:test";

import { Editor } from "@tiptap/core";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { StarterKit } from "@tiptap/starter-kit";

import { DecorationHost } from "@/extensions/decoration-host/decoration-host";

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function create(layers: { name: string; map?: boolean }[]): Editor {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      DecorationHost.configure({ layers }),
    ],
    content: "<p>Hello world</p>",
  });
  return editor;
}

/** Highlights "world" (positions 7–12) in the current document. */
const worldSet = (e: Editor) =>
  DecorationSet.create(e.state.doc, [
    Decoration.inline(7, 12, { class: "hit" }),
  ]);

/** The text under each drawn decoration. */
const hits = (e: Editor) =>
  [...e.view.dom.querySelectorAll(".hit")].map((node) => node.textContent);

describe("DecorationHost", () => {
  it("adds one plugin per declared layer, none without", () => {
    const count = (layers: { name: string }[]) => {
      const e = new Editor({
        element: document.createElement("div"),
        extensions: [DecorationHost.configure({ layers }), StarterKit],
      });
      const plugins = e.state.plugins.length;
      e.destroy();
      return plugins;
    };
    expect(count([{ name: "a" }, { name: "b" }]) - count([])).toBe(2);
    // The command is there for lazy layers; with none declared it is inert.
    expect(
      create([]).commands.setDecorationLayer("find", DecorationSet.empty),
    ).toBe(true);
  });

  it("shows and clears a layer without touching the document or undo", () => {
    const e = create([{ name: "find" }]);
    const doc = e.state.doc;
    e.commands.setDecorationLayer("find", worldSet(e));
    expect(hits(e)).toEqual(["world"]);
    expect(e.state.doc).toBe(doc);
    e.commands.setDecorationLayer("find", DecorationSet.empty);
    expect(hits(e)).toEqual([]);
  });

  it("leaves other layers alone", () => {
    const e = create([{ name: "find" }, { name: "comments", map: true }]);
    e.commands.setDecorationLayer("comments", worldSet(e));
    e.commands.setDecorationLayer("find", worldSet(e));
    e.commands.setDecorationLayer("find", DecorationSet.empty);
    expect(hits(e)).toEqual(["world"]);
  });

  it("clears a plain layer on a document change", () => {
    const e = create([{ name: "find" }]);
    e.commands.setDecorationLayer("find", worldSet(e));
    e.commands.insertContentAt(1, "Oh ");
    expect(hits(e)).toEqual([]);
  });

  it("maps a map: true layer through a document change", () => {
    const e = create([{ name: "comments", map: true }]);
    e.commands.setDecorationLayer("comments", worldSet(e));
    e.commands.insertContentAt(1, "Oh ");
    expect(hits(e)).toEqual(["world"]);
  });
});
