/**
 * The page's geometry (preferences design §5.4, §5.9) for the schema. No
 * imports. `styles/_page.scss` holds the same table for the card, the
 * skeleton and `--page-dock-min`, which `PageFrame` reads; the e2e suite
 * checks the two agree for every size and width.
 */

export type PageWidth = "narrow" | "standard" | "wide" | "full";

/** Line lengths in em of the text size; Full keeps text to 46 em. */
export const PAGE_MEASURES: Readonly<Record<PageWidth, number | null>> = {
  narrow: 30,
  standard: 33,
  wide: 46,
  full: null,
};
export const FULL_TEXT_MEASURE = 46;
/** Full's card measure: wide enough that the card fills any main area. */
export const FULL_CARD_MEASURE = 10000;
/** The Default style's text size (px at a 16 px root) and width. */
export const DEFAULT_TEXT_SIZE = 16;
export const DEFAULT_PAGE_WIDTH: PageWidth = "standard";
/** The docked outline (270 px) plus its 32 px gutter, from `toc-sidebar.scss`. */
export const OUTLINE_DOCK_EXTRA_PX = 302;
/** The card's 3 rem padding on each side. */
export const CARD_PADDING_REM = 6;
/** Today's card, kept by `classic`: 648 + 302 docks at 950 px, as before. */
export const CLASSIC_CARD_PX = 648;

/** What the card's width depends on; `null` is `classic`. */
export type PageGeometry = { size: number; width: PageWidth } | null;

/**
 * The page card's width in CSS px, computed, never measured, so nothing
 * changes on its own. Null for Full. `rootPx` is the root font size (the
 * browser's default text size).
 */
export function cardWidthFor(
  geometry: PageGeometry,
  rootPx = 16,
): number | null {
  if (!geometry) return CLASSIC_CARD_PX;
  const measure = PAGE_MEASURES[geometry.width];
  if (measure === null) return null;
  return (measure * geometry.size * rootPx) / 16 + CARD_PADDING_REM * rootPx;
}

/** The narrowest main area that docks the outline; Full never docks. */
export function dockMinPxFor(geometry: PageGeometry, rootPx = 16): number {
  const card = cardWidthFor(geometry, rootPx);
  return card === null
    ? Number.POSITIVE_INFINITY
    : card + OUTLINE_DOCK_EXTRA_PX;
}
