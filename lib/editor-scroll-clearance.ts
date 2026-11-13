/**
 * How far ProseMirror keeps the caret from the edges of the scroll
 * container when it scrolls the selection into view (`scrollMargin` /
 * `scrollThreshold`). ProseMirror ignores CSS `scroll-padding`.
 *
 * - Top: 52 = `--tt-toolbar-height` (44) + 8px of air under the sticky row.
 * - Bottom: 8px of air, plus the phone's docked bar and the on-screen
 *   keyboard under it (spec §6.8) while that bar is mounted.
 *
 * One object with getters: `EDITOR_PROPS` keeps its identity (no
 * `setOptions`), and ProseMirror reads the live values on every scroll.
 */
const AIR = 8;
const ROW_CLEARANCE = 44 + AIR;

let barClearance = 0;

export const SCROLL_CLEARANCE = {
  /** No sticky row on top while the docked bar replaces it. */
  get top() {
    return barClearance > 0 ? AIR : ROW_CLEARANCE;
  },
  get bottom() {
    return AIR + barClearance;
  },
  left: 0,
  right: 0,
};

/** Height of the docked bar plus the keyboard inset; 0 when unmounted. */
export function setMobileBarClearance(px: number): void {
  barClearance = Number.isFinite(px) && px > 0 ? Math.round(px) : 0;
}
