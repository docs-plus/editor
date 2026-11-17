import { posToDOMRect } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import {
  type BubblePlacement,
  type BubbleRect,
  firstLineRect,
  lastLineRect,
} from "./bubble-rules";

/**
 * The bubble's anchor (spec §12.1, BQ3): one selected line inside the
 * visible band, never the union rectangle, measured from a DOM range of at
 * most `MAX_RANGE` positions. `getClientRects` over a ⌘A range would lay
 * out every `content-visibility`-skipped block.
 */

/** Most positions one anchor range spans. */
const MAX_RANGE = 300;
const STICKY_TOOLBAR = ':scope > [data-slot="toolbar"]';

interface Band {
  top: number;
  bottom: number;
}

/** Under the sticky row (else the scroll target's top), above its bottom. */
function visibleBand(scrollTarget: HTMLElement): Band {
  const box = scrollTarget.getBoundingClientRect();
  const toolbar = scrollTarget.querySelector(STICKY_TOOLBAR);
  return {
    top: toolbar ? toolbar.getBoundingClientRect().bottom : box.top,
    bottom: box.bottom,
  };
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** The document position at the editor's left edge, `top` px down. */
function posAtBandEdge(view: EditorView, top: number): number | undefined {
  const left = view.dom.getBoundingClientRect().left + 1;
  return view.posAtCoords({ left, top })?.pos;
}

/** Client rects of the DOM range between two document positions. */
function rangeRects(view: EditorView, from: number, to: number): DOMRect[] {
  const start = view.domAtPos(from);
  const end = view.domAtPos(to);
  const range = view.dom.ownerDocument.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return Array.from(range.getClientRects());
}

/**
 * `pos`, or the nearest position inside a textblock in direction `dir`,
 * never past `limit`. A range that starts (or ends) on a block boundary
 * holds that whole block, and `getClientRects` returns its border box: the
 * "first line" of select all would be the title's whole box.
 */
export function intoTextblock(
  doc: ProseMirrorNode,
  pos: number,
  dir: 1 | -1,
  limit: number,
): number {
  const $pos = doc.resolve(pos);
  if ($pos.parent.inlineContent) return pos;
  const found = TextSelection.findFrom($pos, dir, true)?.head;
  if (found === undefined) return pos;
  return dir > 0 ? Math.min(found, limit) : Math.max(found, limit);
}

/**
 * The first line that shows in the band, read forward from `start` one
 * textblock at a time: each range stays inside one textblock, so it never
 * holds a whole block (whose border box `getClientRects` would return).
 * A position at a textblock's end, or an empty textblock, has no line:
 * the scan goes on to the next. At most `MAX_RANGE` positions in all.
 */
function firstLineFrom(
  view: EditorView,
  band: Band,
  start: number,
  to: number,
) {
  const { doc } = view.state;
  let pos = start;
  let budget = MAX_RANGE;
  while (budget > 0 && pos < to) {
    pos = intoTextblock(doc, pos, 1, to);
    const $pos = doc.resolve(pos);
    if (!$pos.parent.inlineContent) return null;
    const end = Math.min($pos.end(), to, pos + budget);
    if (end > pos) {
      const line = firstLineRect(rangeRects(view, pos, end), band);
      if (line) return line;
    }
    budget -= Math.max(1, end - pos);
    pos = $pos.after();
  }
  return null;
}

/** Like `firstLineFrom`, backward from `end` for the last line. */
function lastLineFrom(view: EditorView, band: Band, from: number, end: number) {
  const { doc } = view.state;
  let pos = end;
  let budget = MAX_RANGE;
  while (budget > 0 && pos > from) {
    pos = intoTextblock(doc, pos, -1, from);
    const $pos = doc.resolve(pos);
    if (!$pos.parent.inlineContent) return null;
    const start = Math.max($pos.start(), from, pos - budget);
    if (pos > start) {
      const line = lastLineRect(rangeRects(view, start, pos), band);
      if (line) return line;
    }
    budget -= Math.max(1, pos - start);
    pos = $pos.before();
  }
  return null;
}

/**
 * First selected line in the band, from where the band starts. Positions
 * are moved into a textblock before `coordsAtPos` reads them: at the
 * document's edges it measures whatever the view's first or last child is.
 */
function topAnchor(view: EditorView, band: Band, from: number, to: number) {
  let start = intoTextblock(view.state.doc, from, 1, to);
  if (view.coordsAtPos(start).bottom < band.top) {
    const hit = posAtBandEdge(view, band.top + 1);
    if (hit !== undefined) start = clamp(hit, from, to);
  }
  return firstLineFrom(view, band, start, to);
}

/**
 * Last selected line, with `room` px free under it inside the band. When
 * the selection runs past the band's bottom (select all), or its last line
 * sits too close to that edge, the bubble under it would leave the view:
 * it goes under the first line that shows instead.
 */
function bottomAnchor(
  view: EditorView,
  band: Band,
  from: number,
  to: number,
  room: number,
) {
  const end = intoTextblock(view.state.doc, to, -1, from);
  if (view.coordsAtPos(end).top > band.bottom) {
    return topAnchor(view, band, from, to);
  }
  const line = lastLineFrom(view, band, from, end);
  if (line && line.bottom + room > band.bottom) {
    return topAnchor(view, band, from, to);
  }
  return line;
}

const toDOMRect = ({ left, top, right, bottom }: BubbleRect) =>
  new DOMRect(left, top, right - left, bottom - top);

/** The selection's union rect (the plugin's anchor), or an empty rect. */
function selectionRect(view: EditorView, from: number, to: number): DOMRect {
  try {
    return toDOMRect(posToDOMRect(view, from, to));
  } catch {
    return new DOMRect();
  }
}

/**
 * The rect the bubble anchors to: the first selected line that shows in
 * the scroll target's band for `"top"`, the last selected line for
 * `"bottom"` (the first that shows when the selection runs past the band,
 * or when `room`, the bubble's height plus its offset, does not fit under
 * the last). Falls back to the selection's union rect when no line shows
 * or measuring throws.
 */
export function bubbleReferenceRect(
  view: EditorView,
  scrollTarget: HTMLElement,
  placement: BubblePlacement,
  room = 0,
): DOMRect {
  const { from, to } = view.state.selection;
  try {
    const band = visibleBand(scrollTarget);
    const line =
      placement === "top"
        ? topAnchor(view, band, from, to)
        : bottomAnchor(view, band, from, to, room);
    if (line) return toDOMRect(line);
  } catch {
    // Positions the DOM no longer has (a remote step replaced the block).
  }
  return selectionRect(view, from, to);
}
