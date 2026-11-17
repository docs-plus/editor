import { posToDOMRect } from "@tiptap/core";
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

/** First selected line in the band, from where the band starts. */
function topAnchor(view: EditorView, band: Band, from: number, to: number) {
  let start = from;
  if (view.coordsAtPos(from).bottom < band.top) {
    const hit = posAtBandEdge(view, band.top + 1);
    if (hit !== undefined) start = clamp(hit, from, to);
  }
  const rects = rangeRects(view, start, Math.min(to, start + MAX_RANGE));
  return firstLineRect(rects, band);
}

/** Last selected line in the band, from where the band ends. */
function bottomAnchor(view: EditorView, band: Band, from: number, to: number) {
  let end = to;
  if (view.coordsAtPos(to).top > band.bottom) {
    const hit = posAtBandEdge(view, band.bottom - 1);
    if (hit !== undefined) end = clamp(hit, from, to);
  }
  const rects = rangeRects(view, Math.max(from, end - MAX_RANGE), end);
  return lastLineRect(rects, band);
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
 * the scroll target's band for `"top"`, the last for `"bottom"`. Falls back
 * to the selection's union rect when no line shows or measuring throws.
 */
export function bubbleReferenceRect(
  view: EditorView,
  scrollTarget: HTMLElement,
  placement: BubblePlacement,
): DOMRect {
  const { from, to } = view.state.selection;
  try {
    const band = visibleBand(scrollTarget);
    const line =
      placement === "top"
        ? topAnchor(view, band, from, to)
        : bottomAnchor(view, band, from, to);
    if (line) return toDOMRect(line);
  } catch {
    // Positions the DOM no longer has (a remote step replaced the block).
  }
  return selectionRect(view, from, to);
}
