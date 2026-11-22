import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { liftTarget } from "@tiptap/pm/transform";

import {
  setStyleLift,
  type TextStyleValue,
} from "@/lib/editor-actions/core/blocks";

/*
 * The per-item lift behind the text styles (Turn into, spec §7.2), kept out
 * of the editor chunk: `core/blocks.ts` holds only the hook, and this
 * module installs it when it is imported. The lazy chunks that offer text
 * styles import it (bubble, menus, "/", phone, palette); the bubble's loads
 * on idle. Importing it again only reinstalls the same function.
 */

/** A textblock directly in one of these is lifted by a text style. */
const WRAPS = /^(listItem|taskItem|blockquote)$/;

/** The selected textblocks directly in a list item or quote, last first. */
export function wrappedBlocks(tr: Transaction): number[] {
  const found: number[] = [];
  tr.doc.nodesBetween(
    tr.selection.from,
    tr.selection.to,
    (node, pos, parent) => {
      if (node.isTextblock && WRAPS.test(parent?.type.name ?? "")) {
        found.unshift(pos);
      }
      return !node.isTextblock;
    },
  );
  return found;
}

/**
 * Lifts each selected textblock out of its list items and quotes, one
 * block at a time and last first, so unselected siblings (and their
 * children) stay where they are (spec §7.2). A table cell is isolating:
 * nothing lifts out of one.
 */
export function liftWrapped(tr: Transaction): boolean {
  for (let pos of wrappedBlocks(tr)) {
    for (
      let $pos = tr.doc.resolve(pos);
      WRAPS.test($pos.parent.type.name);
      $pos = tr.doc.resolve(pos)
    ) {
      const range = $pos.blockRange(
        tr.doc.resolve(pos + ($pos.nodeAfter?.nodeSize ?? 0)),
      );
      const target = range && liftTarget(range);
      if (!range || target === null) break;
      const steps = tr.steps.length;
      tr.lift(range, target);
      pos = tr.mapping.slice(steps).map(pos + 1) - 1;
    }
  }
  return true;
}

/**
 * `setTextStyle` over selected list items and quote lines: lift them, then
 * set the style, in one transaction (one undo step). `undefined` when the
 * selection has none, so the registry's own path runs.
 */
export function liftStyle(
  editor: Editor,
  value: Exclude<TextStyleValue, "title">,
): boolean | undefined {
  if (wrappedBlocks(editor.state.tr).length === 0) return undefined;
  const level = value === "paragraph" ? 0 : Number(value.slice(8));
  try {
    const empty = editor.state.selection.empty;
    const chain = editor
      .chain()
      .focus()
      .command(({ tr }) => liftWrapped(tr));
    (level
      ? chain.setNode("heading", { level })
      : chain.setNode("paragraph")
    ).run();
    // A caret moves to the end of its block; a range stays selected.
    const next = editor.chain().focus();
    (empty ? next.selectTextblockEnd() : next).run();
    return true;
  } catch {
    return false;
  }
}

setStyleLift(liftStyle);
