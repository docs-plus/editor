import { afterEach, describe, expect, it } from "bun:test";

import type { Editor } from "@tiptap/core";

import { importFresh, resetModules } from "@/tests/helpers/import-fresh";

import { createTestEditor } from "../../helpers/create-test-editor";
import {
  bulletList,
  doc,
  h1,
  listItem,
  p,
  posInside,
} from "../../helpers/document-builders";

type Blocks = typeof import("@/lib/editor-actions/core/blocks");

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  resetModules();
});

/** Top-level block types, without the trailing node's empty paragraph. */
const types = (target: Editor) => {
  const out: string[] = [];
  target.state.doc.forEach((node) => {
    out.push(node.type.name);
  });
  if (target.state.doc.lastChild?.content.size === 0) out.pop();
  return out;
};

describe("style lift injection (spec §7.2, A20)", () => {
  it("is absent at first (main's behaviour) and lifts once the lazy module is imported", async () => {
    const blocks = await importFresh<Blocks>(
      "@/lib/editor-actions/core/blocks",
    );
    editor = createTestEditor({
      content: doc(
        h1("Title"),
        bulletList(
          listItem(p("One")),
          listItem(p("Two")),
          listItem(p("Three")),
        ),
      ).toJSON(),
    });
    editor.commands.setTextSelection(posInside(editor, "Two"));
    // No hook: the item's paragraph already is Text, so nothing happens.
    expect(blocks.setTextStyle(editor, "paragraph")).toBe(false);
    expect(types(editor)).toEqual(["heading", "bulletList"]);

    // The lazy chunks import this module; it installs the hook.
    await import("@/lib/editor-actions/style-lift");
    editor.commands.setTextSelection(posInside(editor, "Two"));
    expect(blocks.setTextStyle(editor, "paragraph")).toBe(true);
    expect(types(editor)).toEqual([
      "heading",
      "bulletList",
      "paragraph",
      "bulletList",
    ]);
  });

  it("installing it twice keeps one hook (a re-import only replaces it)", async () => {
    const blocks = await importFresh<Blocks>(
      "@/lib/editor-actions/core/blocks",
    );
    const lift = await import("@/lib/editor-actions/style-lift");
    blocks.setStyleLift(lift.liftStyle);
    editor = createTestEditor({
      content: doc(h1("Title"), bulletList(listItem(p("One")))).toJSON(),
    });
    editor.commands.setTextSelection(posInside(editor, "One"));
    expect(blocks.setTextStyle(editor, "heading-2")).toBe(true);
    expect(types(editor)).toEqual(["heading", "heading"]);
  });
});
