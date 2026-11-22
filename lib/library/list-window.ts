/**
 * Windowing for the list views (details spec §6.3: virtualized, ≤ 100 ms
 * first paint at 1,000 documents, ≤ 300 ms at 10,000): rows have a fixed
 * height per kind, so offsets are one prefix sum and the visible range is a
 * binary search. Scroll anchoring keeps visible rows still when rows are
 * inserted above them (UX §4.5).
 */

/** `offsets[i]` is row i's top; `offsets[length]` is the total height. */
export function rowOffsets(heights: readonly number[]): Float64Array {
  const offsets = new Float64Array(heights.length + 1);
  for (let at = 0; at < heights.length; at++) {
    offsets[at + 1] = offsets[at] + heights[at];
  }
  return offsets;
}

/** The last row whose top is at or above `y`. */
function rowAt(offsets: Float64Array, y: number): number {
  let low = 0;
  let high = offsets.length - 2;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (offsets[mid] <= y) low = mid;
    else high = mid - 1;
  }
  return Math.max(low, 0);
}

/** Rows `[start, end)` to render. */
export function visibleRange(
  offsets: Float64Array,
  scrollTop: number,
  viewport: number,
  overscan: number,
): { start: number; end: number } {
  const count = offsets.length - 1;
  if (count <= 0) return { start: 0, end: 0 };
  const first = rowAt(offsets, scrollTop);
  const last = rowAt(offsets, scrollTop + Math.max(viewport - 1, 0));
  return {
    start: Math.max(0, first - overscan),
    end: Math.min(count, last + overscan + 1),
  };
}

/** The scrollTop that shows row `index` whole, moving as little as needed. */
export function scrollToShow(
  offsets: Float64Array,
  index: number,
  scrollTop: number,
  viewport: number,
): number {
  const top = offsets[index];
  const bottom = offsets[index + 1];
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewport) return bottom - viewport;
  return scrollTop;
}

/** A row and how far its top is below the scroll position. */
export interface ScrollAnchor {
  readonly key: string;
  readonly delta: number;
}

/** Where to scroll so the anchor row stays put; null if it is gone. */
export function anchoredScrollTop(
  anchor: ScrollAnchor,
  keys: readonly string[],
  offsets: Float64Array,
): number | null {
  const index = keys.indexOf(anchor.key);
  if (index < 0) return null;
  return Math.max(0, offsets[index] - anchor.delta);
}
