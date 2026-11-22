import {
  HIGHLIGHT_TOKENS,
  type HighlightToken,
  TEXT_COLOR_TOKENS,
  type TextColorToken,
} from "@/lib/text-style-tokens";

/**
 * Display order of the named colour rows (spec §7.3, O2): the first five
 * per section are picked for contrast spread and common meaning; the rest
 * sit under "More colours ▸" / "More highlights ▸" in token order. Only a
 * display order: the token lists stay append-only and unchanged. Lazy
 * colour chunk (imported by `color-rows.tsx` only).
 */
export const FIRST_TEXT_COLORS = [
  "red",
  "orange",
  "green",
  "blue",
  "purple",
] as const satisfies readonly TextColorToken[];

export const FIRST_HIGHLIGHTS = [
  "yellow",
  "green",
  "blue",
  "pink",
] as const satisfies readonly HighlightToken[];

const rest = <T extends string>(all: readonly T[], first: readonly T[]) =>
  all.filter((token) => !first.includes(token));

export const MORE_TEXT_COLORS: readonly TextColorToken[] = rest(
  TEXT_COLOR_TOKENS,
  FIRST_TEXT_COLORS,
);
export const MORE_HIGHLIGHTS: readonly HighlightToken[] = rest(
  HIGHLIGHT_TOKENS,
  FIRST_HIGHLIGHTS,
);

/** Recent (one line of chips), then the Text and Highlight columns. */
export interface RowsPos {
  section: "recent" | "text" | "highlight";
  index: number;
}

/** Items per section; each column's last item is its "More" row. */
export interface RowsSizes {
  recent: number;
  text: number;
  highlight: number;
}

/** Whether `key` points toward the inline end (right in LTR, left in RTL). */
const towardEnd = (key: string, rtl: boolean) => (key === "ArrowRight") !== rtl;

const clamp = (index: number, size: number) =>
  Math.max(0, Math.min(index, size - 1));

/**
 * Where an arrow key moves in the named rows: Up/Down within a column
 * (from a column's top up to Recent, from Recent down to Text); Left/Right
 * across to the same row of the other column, in visual order, so RTL
 * swaps them; the inline-end arrow on a "More" row opens its submenu.
 * Home/End reach the section's ends. Null: handled, nowhere to go.
 * Undefined: not a key the rows handle.
 */
export function rowsStep(
  pos: RowsPos,
  key: string,
  rtl: boolean,
  sizes: RowsSizes,
): RowsPos | "open-more" | null | undefined {
  const { section, index } = pos;
  const size = sizes[section];
  const move = (next: RowsPos | null) =>
    next && next.index >= 0 && next.index < sizes[next.section] ? next : null;
  switch (key) {
    case "Home":
      return { section, index: 0 };
    case "End":
      return { section, index: size - 1 };
    case "ArrowDown":
      return move(
        section === "recent"
          ? { section: "text", index: 0 }
          : { section, index: index + 1 },
      );
    case "ArrowUp":
      if (section !== "recent" && index === 0) {
        return move({ section: "recent", index: 0 });
      }
      return move({ section, index: index - 1 });
    case "ArrowLeft":
    case "ArrowRight": {
      const forward = towardEnd(key, rtl);
      if (section === "recent") {
        return move({ section, index: index + (forward ? 1 : -1) });
      }
      if (forward && index === size - 1) return "open-more";
      if (forward !== (section === "text")) return null;
      const other = section === "text" ? "highlight" : "text";
      return move({ section: other, index: clamp(index, sizes[other]) });
    }
    default:
      return undefined;
  }
}

/**
 * Arrow keys in a "More" submenu: Up/Down/Home/End move; the inline-start
 * arrow closes it (back to its "More" row). Same null/undefined meaning
 * as `rowsStep`.
 */
export function moreStep(
  index: number,
  key: string,
  rtl: boolean,
  size: number,
): number | "close" | null | undefined {
  const within = (next: number) => (next >= 0 && next < size ? next : null);
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return size - 1;
    case "ArrowDown":
      return within(index + 1);
    case "ArrowUp":
      return within(index - 1);
    case "ArrowLeft":
    case "ArrowRight":
      return towardEnd(key, rtl) ? null : "close";
    default:
      return undefined;
  }
}
