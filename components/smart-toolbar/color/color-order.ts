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
 * Where an arrow key moves in the named rows (spec §7.10): Up/Down move
 * within a column and wrap, through Recent (one stop above both columns;
 * Up from it lands on the Text column's last row); Left/Right cross to
 * the same row of the other column, in visual order, so RTL swaps them;
 * the inline-end arrow on a "More" row opens its submenu. Home/End reach
 * the section's ends. Null: handled, nowhere to go. Undefined: not a key
 * the rows handle.
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
  const recent: RowsPos | null =
    sizes.recent > 0 ? { section: "recent", index: 0 } : null;
  switch (key) {
    case "Home":
      return { section, index: 0 };
    case "End":
      return { section, index: size - 1 };
    case "ArrowDown":
      if (section === "recent") return move({ section: "text", index: 0 });
      if (index < size - 1) return { section, index: index + 1 };
      return recent ?? { section, index: 0 };
    case "ArrowUp":
      if (section === "recent") {
        return move({ section: "text", index: sizes.text - 1 });
      }
      if (index > 0) return { section, index: index - 1 };
      return recent ?? { section, index: size - 1 };
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
 * Arrow keys in a "More" submenu: Up/Down move and wrap, Home/End reach
 * its ends; the inline-start arrow closes it (back to its "More" row).
 * Same null/undefined meaning as `rowsStep`.
 */
export function moreStep(
  index: number,
  key: string,
  rtl: boolean,
  size: number,
): number | "close" | null | undefined {
  switch (key) {
    case "Home":
      return 0;
    case "End":
      return size - 1;
    case "ArrowDown":
      return (index + 1) % size;
    case "ArrowUp":
      return (index - 1 + size) % size;
    case "ArrowLeft":
    case "ArrowRight":
      return towardEnd(key, rtl) ? null : "close";
    default:
      return undefined;
  }
}

/**
 * Typeahead (spec §7.10, APG menu): the next row after `current` whose
 * label starts with the typed letter, wrapping; null when none does or
 * the key is not a single letter or digit.
 */
export function typeahead(
  labels: readonly string[],
  current: number,
  key: string,
): number | null {
  if (!/^[\p{L}\p{N}]$/u.test(key)) return null;
  const letter = key.toLocaleLowerCase();
  for (let step = 1; step <= labels.length; step += 1) {
    const at = (current + step) % labels.length;
    if (labels[at].toLocaleLowerCase().startsWith(letter)) return at;
  }
  return null;
}
