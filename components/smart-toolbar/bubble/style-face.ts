import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import type { EditorState } from "@tiptap/pm/state";
import { useSyncExternalStore } from "react";

import { TEXT_STYLE_LABELS } from "@/lib/editor-actions/core/blocks";
import { getEditorContextStore } from "@/lib/editor-context/store";

/**
 * The Style ▾ face (spec §7.1, §7.2): the selection's block type as one
 * fixed word (BQ11). Faces use H1–H6; menus and names use "Heading 2".
 */
export type StyleFace =
  | "Text"
  | "H1"
  | "H2"
  | "H3"
  | "H4"
  | "H5"
  | "H6"
  | "Title"
  | "List"
  | "Quote"
  | "Code"
  | "Mixed";

/** Every face word, for sizing the face to the longest once (§7.1 Sizes). */
export const STYLE_FACES: readonly StyleFace[] = [
  "Text",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "Title",
  "List",
  "Quote",
  "Code",
  "Mixed",
];

/**
 * The face's accessible name, where the word alone is short ("H2"): the
 * registry's own labels (BQ11, one source), plus "Code block".
 */
export const STYLE_FACE_NAMES: Readonly<Record<StyleFace, string>> = {
  Text: TEXT_STYLE_LABELS.paragraph,
  H1: TEXT_STYLE_LABELS["heading-1"],
  H2: TEXT_STYLE_LABELS["heading-2"],
  H3: TEXT_STYLE_LABELS["heading-3"],
  H4: TEXT_STYLE_LABELS["heading-4"],
  H5: TEXT_STYLE_LABELS["heading-5"],
  H6: TEXT_STYLE_LABELS["heading-6"],
  Title: TEXT_STYLE_LABELS.title,
  List: "List",
  Quote: "Quote",
  Code: "Code block",
  Mixed: TEXT_STYLE_LABELS.mixed,
};

const LISTS = new Set(["bulletList", "orderedList", "taskList"]);

/**
 * One top-level block's face, or null for a block that has no type to
 * turn into (a rule, an image, a diagram), which the walk skips. A table
 * reads as its cells' paragraphs (spec §7.2).
 */
function blockFace(node: PMNode, index: number): StyleFace | null {
  const name = node.type.name;
  if (index === 0 && name === "heading") return "Title";
  if (name === "heading") return `H${node.attrs.level as 1}`;
  if (name === "paragraph" || name === "table") return "Text";
  if (LISTS.has(name)) return "List";
  if (name === "blockquote") return "Quote";
  if (name === "codeBlock") return "Code";
  return null;
}

/**
 * The face for `state`'s selection. Walks the top-level blocks the
 * selection touches by index, never `nodesBetween` (which visits every
 * block of a ⌘A range), and returns at the second distinct type, so the
 * cost is O(blocks until two types differ) (spec §7.2 "Very long
 * selection").
 */
export function styleFace(state: EditorState): StyleFace {
  const { doc, selection } = state;
  const { $from, $to } = selection;
  const last = doc.childCount - 1;
  const start = Math.min($from.index(0), last);
  // A range that ends between blocks (a top-level node selection) or at
  // the very start of a top-level block does not touch that block.
  const before =
    !selection.empty &&
    ($to.depth === 0 || $to.pos === $to.start(1) + $to.depth - 1);
  const end = Math.max(start, Math.min($to.index(0) - (before ? 1 : 0), last));
  let face: StyleFace | null = null;
  for (let index = start; index <= end; index += 1) {
    const own = blockFace(doc.child(index), index);
    if (own === null || own === face) continue;
    if (face !== null) return "Mixed";
    face = own;
  }
  return face ?? "Text";
}

const serverFace = (): StyleFace => "Text";

/**
 * The live face, re-rendered when it changes: subscribed to the editor's
 * shared context store (selection at once, doc changes after the settle
 * window), with the face word as the snapshot, so a caret moving from a
 * paragraph into a list or a remote edit updates it.
 */
export function useStyleFace(editor: Editor): StyleFace {
  return useSyncExternalStore(
    getEditorContextStore(editor).subscribe,
    () => styleFace(editor.state),
    serverFace,
  );
}
