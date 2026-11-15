/**
 * The Paint format brush pressed before the lazy engine lands
 * (`paint-pending.ts`): it keeps the pressed text across a moved
 * selection and edits, arms there once the engine lands and paints the
 * new selection when asked; a landing mid-drag waits for the pointer-up;
 * a second press on the same text and Esc cancel.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import type * as Y from "yjs";

import {
  isPaintPending,
  pressBrush,
} from "@/components/smart-toolbar/formats/paint-pending";
import { RepeatFormatting } from "@/extensions/repeat-formatting";
import { resetBundleMemoryForTests } from "@/extensions/repeat-formatting/bundle-memory";
import { dismissNotice, getNotice } from "@/lib/announce";
import { PAINT_PILLS } from "@/lib/editor-actions/paint-format-ui";
import {
  getV11Engine,
  installV11Engine,
  resetV11EngineForTests,
} from "@/lib/editor-actions/v11-actions";
import { v11Engine } from "@/lib/editor-actions/v11-engine";

import {
  type CollabEditorFixture,
  createCollabEditor,
} from "../../helpers/collab-editor";

let f: CollabEditorFixture | null = null;
let editor: Editor;

/** Past the engine import's microtasks and a frame. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 40));

function sel(text: string): void {
  let found: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found || !node.isText) return !found;
    const index = node.text?.indexOf(text) ?? -1;
    if (index >= 0) {
      found = { from: pos + index, to: pos + index + text.length };
    }
    return false;
  });
  if (!found) throw new Error(`text not found: ${text}`);
  const { from, to } = found as { from: number; to: number };
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, from, to),
    ),
  );
}

/** Mark names on the text node holding `text`. */
function marksOf(text: string): string[] {
  let names: string[] = [];
  editor.state.doc.descendants((node) => {
    if (node.isText && node.text?.includes(text)) {
      names = node.marks.map((mark) => mark.type.name);
      return false;
    }
    return true;
  });
  return names;
}

function pointer(type: "pointerdown" | "pointerup", target: EventTarget) {
  target.dispatchEvent(
    new PointerEvent(type, { bubbles: true, pointerType: "mouse" }),
  );
}

beforeEach(() => {
  resetBundleMemoryForTests();
  resetV11EngineForTests();
  f = createCollabEditor({ extensions: [RepeatFormatting] });
  editor = f.editor;
  // The press listens on `document`: mount the editor.
  document.body.append(editor.options.element as HTMLElement);
  sel("hello");
  editor.commands.toggleBold();
});

afterEach(() => {
  (editor.options.element as HTMLElement).remove();
  f?.destroy();
  f = null;
  // Other files share this process: leave the engine installed.
  installV11Engine(v11Engine);
  dismissNotice();
  resetBundleMemoryForTests();
});

describe("Paint format pressed before the engine lands", () => {
  it("shows pressed at once and paints the newly selected text once it lands", async () => {
    pressBrush(editor, true);
    expect(getV11Engine()).toBeNull();
    expect(isPaintPending(editor)).toBe(true);
    expect(getNotice()?.text).toBe(PAINT_PILLS.touch);
    // A collaborator types before the pressed text; then a new selection
    // and the brush again on it.
    f?.remote((frag) => {
      const paragraph = frag.get(1) as Y.XmlElement;
      (paragraph.get(0) as Y.XmlText).insert(0, "XX ");
    });
    sel("world");
    pressBrush(editor, true);
    expect(isPaintPending(editor)).toBe(true);

    installV11Engine(v11Engine); // the chunk evaluates during the load
    await settle();
    expect(isPaintPending(editor)).toBe(false);
    expect(marksOf("world")).toEqual(["bold"]);
    expect(marksOf("XX")).toEqual([]);
    expect(v11Engine.paint.isPainting(editor)).toBe(false);
    expect(getNotice()?.text).toBe(PAINT_PILLS.applied);
  });

  it("only arms when the selection did not move to other text", async () => {
    pressBrush(editor, false);
    installV11Engine(v11Engine);
    await settle();
    expect(isPaintPending(editor)).toBe(false);
    expect(v11Engine.paint.isPainting(editor)).toBe(true);
    v11Engine.paint.toggle(editor); // the brush again cancels
    expect(v11Engine.paint.isPainting(editor)).toBe(false);
  });

  it("a landing mid-drag paints at the pointer-up, a frame later", async () => {
    pressBrush(editor, false);
    pointer("pointerdown", editor.view.dom);
    sel("world");
    installV11Engine(v11Engine);
    await settle();
    expect(isPaintPending(editor)).toBe(true);
    expect(marksOf("world")).toEqual([]);
    pointer("pointerup", document);
    await settle();
    expect(isPaintPending(editor)).toBe(false);
    expect(marksOf("world")).toEqual(["bold"]);
  });

  it("a second press on the same text, or Esc in the text, cancels", async () => {
    pressBrush(editor, false);
    pressBrush(editor, false);
    expect(isPaintPending(editor)).toBe(false);
    expect(getNotice()).toBeNull();

    pressBrush(editor, false);
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(isPaintPending(editor)).toBe(false);
    expect(
      editor.view.dom.parentElement?.classList.contains("is-painting"),
    ).toBe(false);

    sel("world");
    installV11Engine(v11Engine);
    await settle();
    expect(v11Engine.paint.isPainting(editor)).toBe(false);
    expect(marksOf("world")).toEqual([]);
  });

  it("drops the press when the editor goes read-only", () => {
    pressBrush(editor, false);
    editor.setEditable(false);
    expect(isPaintPending(editor)).toBe(false);
  });
});
