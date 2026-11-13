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
  | { type: "media.options" };

type Listener = (intent: UiIntent) => boolean | undefined;

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

/** True when a listener handled the intent (returned anything but false). */
export function emitUiIntent(editor: Editor, intent: UiIntent): boolean {
  let handled = false;
  for (const listener of listeners.get(editor) ?? []) {
    if (listener(intent) !== false) handled = true;
  }
  return handled;
}
