import { getMarkRange } from "@tiptap/core";
import {
  type EditorState,
  NodeSelection,
  TextSelection,
} from "@tiptap/pm/state";

/**
 * Selection bubble rules (spec §4.3): pure, so the view stays thin and the
 * rules are unit tested without a browser.
 */

/** B · I · U, text colour, link. Every one is also a row control. */
export const BUBBLE_ACTION_IDS = [
  "mark.bold",
  "mark.italic",
  "mark.underline",
  "color.text.apply",
  "mark.link",
] as const;

/** What `shouldShowBubble` reads from the editor view. */
export interface BubbleView {
  state: EditorState;
  readonly editable: boolean;
  hasFocus(): boolean;
}

const CODE_BLOCK = "codeBlock";
const HYPERLINK = "hyperlink";

/**
 * The bubble's colour trigger keeps it while its popover (in `body`) is
 * open. `aria-expanded`, not `data-popup-open`: Base UI also stamps that on
 * a trigger whose tooltip is open.
 */
export const OPEN_POPOVER_TRIGGER =
  '[aria-haspopup="dialog"][aria-expanded="true"]';

function isFocusWithBubble(view: BubbleView, root: HTMLElement): boolean {
  if (view.hasFocus()) return true;
  const active =
    typeof document === "undefined" ? null : document.activeElement;
  if (active && root.contains(active)) return true;
  return root.querySelector(OPEN_POPOVER_TRIGGER) !== null;
}

function insideOneLink(state: EditorState, from: number, to: number) {
  const type = state.schema.marks[HYPERLINK];
  if (!type) return false;
  const range = getMarkRange(state.doc.resolve(from), type);
  return range !== undefined && range.from <= from && to <= range.to;
}

/**
 * Whether the bubble shows for this view. An empty selection exits before
 * anything else is read: that is every keystroke while typing.
 *
 * Hidden when read-only, suppressed (a keystroke or Esc dismissed it),
 * unfocused (neither the editor nor the bubble), on a node selection, on a
 * range with no text, with either end in a code block (code and Mermaid),
 * or with both ends inside one hyperlink (its own preview takes over).
 */
export function shouldShowBubble(
  view: BubbleView,
  root: HTMLElement,
  suppressed: boolean,
): boolean {
  const { selection } = view.state;
  if (selection.empty) return false;
  if (!view.editable || suppressed) return false;
  if (!isFocusWithBubble(view, root)) return false;
  if (selection instanceof NodeSelection) return false;
  if (!(selection instanceof TextSelection)) return false;
  const { from, to, $from, $to } = selection;
  const { doc } = view.state;
  if (doc.textBetween(from, to).length === 0) return false;
  if (
    $from.parent.type.name === CODE_BLOCK ||
    $to.parent.type.name === CODE_BLOCK
  ) {
    return false;
  }
  return !insideOneLink(view.state, from, to);
}

/** Keys that never dismiss: modifiers and selection movement. */
const KEEP_KEYS = new Set([
  "Shift",
  "Control",
  "Alt",
  "AltGraph",
  "Meta",
  "OS",
  "Super",
  "Hyper",
  "Fn",
  "FnLock",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

const FUNCTION_KEY = /^F\d{1,2}$/;

/**
 * A keystroke that hides the bubble: Esc, or any key that edits or moves
 * focus. Shortcuts (Ctrl, Meta, Alt: Mod+B, Alt+F10), function keys,
 * modifiers and selection movement keep it.
 */
export function isBubbleDismissKey(event: KeyboardEvent): boolean {
  if (event.key === "Escape") return true;
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (KEEP_KEYS.has(event.key)) return false;
  return !FUNCTION_KEY.test(event.key);
}

const SELECT_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/**
 * A keystroke that makes a new selection on purpose (Shift+Arrow, select
 * all): the bubble may show again after a dismissal.
 */
export function clearsBubbleSuppression(event: KeyboardEvent): boolean {
  if (event.shiftKey && SELECT_KEYS.has(event.key)) return true;
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a";
}

export interface BubbleRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export type BubblePlacement = "top" | "bottom";

/** Gap between the selection and the bubble, as the plugin's `offset`. */
export const BUBBLE_OFFSET = 8;

/**
 * Above the selection unless the band it would take (centred, bubble-wide,
 * `BUBBLE_OFFSET` above the selection) starts under the sticky toolbar
 * (`topLimit`) or overlaps a remote caret label.
 */
export function chooseBubblePlacement({
  selection,
  bubble,
  obstacles,
  topLimit,
}: {
  selection: BubbleRect;
  bubble: { width: number; height: number };
  obstacles: readonly BubbleRect[];
  topLimit: number;
}): BubblePlacement {
  const centre = (selection.left + selection.right) / 2;
  const band: BubbleRect = {
    top: selection.top - BUBBLE_OFFSET - bubble.height,
    bottom: selection.top,
    left: centre - bubble.width / 2,
    right: centre + bubble.width / 2,
  };
  if (band.top < topLimit) return "bottom";
  const overlaps = (rect: BubbleRect) =>
    rect.top < band.bottom &&
    rect.bottom > band.top &&
    rect.left < band.right &&
    rect.right > band.left;
  return obstacles.some(overlaps) ? "bottom" : "top";
}
