import type { Editor } from "@tiptap/core";

/**
 * Requests an action cannot fulfil with a transaction: open a surface or
 * toggle shell state. Actions emit; the React shell listens. Owned by PR D1;
 * D2 and E may add variants (append-only union).
 */
export type UiIntent =
  | { type: "outline.toggle" }
  | { type: "filter.toggle" }
  | { type: "theme.toggle" }
  | { type: "palette.open" }
  | { type: "colors.open"; kind: "text" | "highlight" }
  | { type: "insert.open"; kind: "table" | "image" | "embed" }
  /** Alt+F10: focus the open selection bubble's toolbar, else the row. */
  | { type: "toolbar.focus" }
  /**
   * Open the style dropdown at "Remove a format ▸" (design pass §7, from
   * the Save dialog at the 20-format cap). The listener returns `true` at
   * once and opens its menu in the next frame, after the palette closes.
   */
  | { type: "formats.remove" };

/**
 * Return `true` only for an intent this listener handled. D1, D2 and E all
 * listen on one editor; anything else (including a `switch` that falls
 * through) must return `false`.
 */
export type UiIntentListener = (intent: UiIntent) => boolean;
type Listener = UiIntentListener;

const listeners = new WeakMap<Editor, Set<Listener>>();

/** Subscribes the shell of one editor. Returns the unsubscribe. */
export function onUiIntent(editor: Editor, listener: Listener): () => void {
  let set = listeners.get(editor);
  if (!set) {
    set = new Set();
    listeners.set(editor, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

/** True when some listener returned exactly `true`. */
export function emitUiIntent(editor: Editor, intent: UiIntent): boolean {
  let handled = false;
  for (const listener of listeners.get(editor) ?? []) {
    if (listener(intent) === true) handled = true;
  }
  return handled;
}
