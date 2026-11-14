import type { EditorView } from "@tiptap/pm/view";

/** The keys the open "/" menu takes from the editor. */
export type SlashKey =
  | "ArrowUp"
  | "ArrowDown"
  | "Home"
  | "End"
  | "PageUp"
  | "PageDown"
  | "Enter"
  | "Escape";

/** The keys that move the active option by a count, not by a page. */
export type StepKey = Extract<
  SlashKey,
  "ArrowUp" | "ArrowDown" | "Home" | "End"
>;

const KEYS = new Set<string>([
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Enter",
  "Escape",
]);

/**
 * The menu key `event` stands for, or null when the editor keeps it:
 * another key, a modified one (Shift+Enter is a line break, Shift+End
 * selects, Ctrl+Home goes to the top), a key aimed outside this editor,
 * or any key while an IME composition is open (Enter commits the
 * candidate, the arrows move through candidates). The menu listens only
 * while it is open, so Home and End move the caret once it closes.
 */
export function slashKey(
  event: KeyboardEvent,
  view: Pick<EditorView, "dom" | "composing">,
): SlashKey | null {
  if (
    !KEYS.has(event.key) ||
    event.isComposing ||
    event.keyCode === 229 ||
    view.composing ||
    event.shiftKey ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey
  ) {
    return null;
  }
  const { target } = event;
  return target instanceof Node && view.dom.contains(target)
    ? (event.key as SlashKey)
    : null;
}

/**
 * The option ↑ ↓ Home End land on among `count`, from `index` (-1: none
 * active yet, a bare "/"). The arrows wrap; from none, ↓ goes to the
 * first option and ↑ to the last.
 */
export function stepIndex(key: StepKey, index: number, count: number): number {
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  const step = key === "ArrowDown" ? 1 : -1;
  if (index < 0) return step > 0 ? 0 : count - 1;
  return (index + step + count) % count;
}

/** An option's top and bottom edge, in the list's own coordinates (px). */
export interface RowSpan {
  top: number;
  bottom: number;
}

/**
 * The option Page Up or Page Down lands on: the farthest one still on one
 * `page` (the list's visible height) with the active option, so headings
 * count as space and a page holds what the list shows. Always at least
 * one option on, never wrapping. From none active (`index` -1), Page Down
 * goes to the first page's last option and Page Up to the last page's
 * first, as ↓ and ↑ start at the first and the last.
 */
export function pageIndex(
  rows: readonly RowSpan[],
  index: number,
  page: number,
  down: boolean,
): number {
  const last = rows.length - 1;
  if (last < 0) return -1;
  if (down) {
    const limit = (index < 0 ? rows[0].top : rows[index].top) + page;
    let target = index + 1;
    for (let i = target; i <= last && rows[i].bottom <= limit; i++) target = i;
    return Math.min(target, last);
  }
  const from = index < 0 ? last + 1 : index;
  const limit = (index < 0 ? rows[last].bottom : rows[index].bottom) - page;
  let target = from - 1;
  for (let i = target; i >= 0 && rows[i].top >= limit; i--) target = i;
  return Math.max(target, 0);
}
