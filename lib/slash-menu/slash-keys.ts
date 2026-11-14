import type { EditorView } from "@tiptap/pm/view";

/** The keys the open "/" menu takes from the editor. */
export type SlashKey = "ArrowUp" | "ArrowDown" | "Enter" | "Escape";

const KEYS = new Set<string>(["ArrowUp", "ArrowDown", "Enter", "Escape"]);

/**
 * The menu key `event` stands for, or null when the editor keeps it:
 * another key, a modified one (Shift+Enter is a line break), a key aimed
 * outside this editor, or any key while an IME composition is open (Enter
 * commits the candidate, the arrows move through candidates).
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
