import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { liftListItem } from "@tiptap/pm/schema-list";
import {
  type Command,
  EditorState,
  TextSelection,
  type Transaction,
} from "@tiptap/pm/state";
import { canSplit, liftTarget } from "@tiptap/pm/transform";

import {
  setStyleLift,
  type TextStyleValue,
} from "@/lib/editor-actions/core/blocks";

/*
 * The per-item lift behind the text styles (Turn into, spec §7.2), kept out
 * of the editor chunk: `core/blocks.ts` holds only the hook, and this
 * module installs it when it is imported. The lazy chunks that offer text
 * styles import it (bubble, menus, phone, palette; not "/", for its 7 KB
 * budget); the bubble's loads on idle. Importing it again only reinstalls
 * the same function.
 */

/** A textblock directly in one of these is lifted by a text style. */
const WRAPS = /^(listItem|taskItem|blockquote)$/;
const CELLS = /^(tableCell|tableHeader)$/;

/** Whether the position is inside a table cell. */
export function inCell(doc: PMNode, pos: number): boolean {
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if (CELLS.test($pos.node(depth).type.name)) return true;
  }
  return false;
}

/**
 * The selected textblocks directly in a list item or quote, last first;
 * with `skipCells`, none inside a table cell (those keep their type).
 */
export function wrappedBlocks(tr: Transaction, skipCells = false): number[] {
  const found: number[] = [];
  tr.doc.nodesBetween(
    tr.selection.from,
    tr.selection.to,
    (node, pos, parent) => {
      if (
        node.isTextblock &&
        WRAPS.test(parent?.type.name ?? "") &&
        !(skipCells && inCell(tr.doc, pos))
      ) {
        found.unshift(pos);
      }
      return !node.isTextblock;
    },
  );
  return found;
}

/** Runs `command` on `tr`'s document with a caret at `pos`, into `tr`. */
function runAt(tr: Transaction, command: Command, pos: number): boolean {
  const state = EditorState.create({
    doc: tr.doc,
    selection: TextSelection.create(tr.doc, pos),
  });
  let stepped = false;
  command(state, (inner) => {
    for (const step of inner.steps) tr.step(step);
    stepped = inner.steps.length > 0;
  });
  return stepped;
}

/**
 * Gives the textblock at `pos` a list item of its own, so lifting the item
 * moves only it: the item's later blocks start a new item (keeping its
 * attrs) and its earlier ones stay in the old one. A nested list after the
 * block stays with it (its sub-items follow as a list). The block's new
 * position, or null when the item cannot split there.
 */
function isolateInItem(tr: Transaction, pos: number): number | null {
  const $pos = tr.doc.resolve(pos);
  const item = $pos.parent;
  const first = $pos.index() === 0;
  // The lifted half leaves the list, so it starts unchecked.
  const attrs =
    item.type.name === "taskItem"
      ? { ...item.attrs, checked: false }
      : item.attrs;
  const types = [{ type: item.type, attrs }];
  if (!first && !canSplit(tr.doc, pos, 1, types)) return null;
  // The later blocks first, so `pos` stays put.
  const end = pos + ($pos.nodeAfter?.nodeSize ?? 0);
  if (end < $pos.end() && canSplit(tr.doc, end)) tr.split(end);
  if (first) return pos;
  tr.split(pos, 1, types);
  return pos + 2;
}

/** One level out: a list item as `liftListItem` does it, a quote line by its range. */
function liftOnce(tr: Transaction, pos: number): boolean {
  const $pos = tr.doc.resolve(pos);
  const wrapper = $pos.parent.type;
  if (wrapper.name !== "blockquote") {
    const at = isolateInItem(tr, pos);
    // Its sub-items follow as a list; later siblings become its children.
    return at !== null && runAt(tr, liftListItem(wrapper), at + 1);
  }
  const range = $pos.blockRange(
    tr.doc.resolve(pos + ($pos.nodeAfter?.nodeSize ?? 0)),
  );
  const target = range && liftTarget(range);
  if (!range || target === null) return false;
  tr.lift(range, target);
  return true;
}

/**
 * Lifts each selected textblock out of its list items and quotes until it
 * is top level, one block at a time and last first, so the selected items
 * become top-level blocks in order and unselected siblings and children
 * stay (spec §7.2). False when nothing could move. With `skipCells`,
 * blocks in table cells stay (Turn into's cells path).
 */
export function liftWrapped(tr: Transaction, skipCells = false): boolean {
  const before = tr.steps.length;
  for (let pos of wrappedBlocks(tr, skipCells)) {
    // Bounded: each lift moves the block out one level.
    for (let level = 0; level < 32; level += 1) {
      if (!WRAPS.test(tr.doc.resolve(pos).parent.type.name)) break;
      const steps = tr.steps.length;
      if (!liftOnce(tr, pos)) break;
      pos = tr.mapping.slice(steps).map(pos + 1) - 1;
    }
  }
  return tr.steps.length > before;
}

/**
 * `setTextStyle` over selected list items and quote lines: lift them, then
 * set the style, in one transaction (one undo step). `undefined` when the
 * selection has none, so the registry's own path runs; false when they
 * could not move.
 */
export function liftStyle(
  editor: Editor,
  value: Exclude<TextStyleValue, "title">,
): boolean | undefined {
  const { tr, selection, schema } = editor.state;
  if (wrappedBlocks(tr).length === 0) return undefined;
  const level = value === "paragraph" ? 0 : Number(value.slice(8));
  const type = schema.nodes[level ? "heading" : "paragraph"];
  if (!type || !liftWrapped(tr)) return false;
  tr.setBlockType(
    tr.selection.from,
    tr.selection.to,
    type,
    level ? { level } : undefined,
  );
  editor.view.dispatch(tr.scrollIntoView());
  // A caret moves to the end of its block; a range stays selected.
  const next = editor.chain().focus();
  (selection.empty ? next.selectTextblockEnd() : next).run();
  return true;
}

setStyleLift(liftStyle);
