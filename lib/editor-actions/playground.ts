import type { Editor } from "@tiptap/core";

const playgroundEditors = new WeakSet<Editor>();

/**
 * Marks `editor` as the Playground's, so Playground-only actions are offered
 * in it. The shell calls it while the Playground is open; returns the unmark.
 */
export function markPlaygroundEditor(editor: Editor): () => void {
  playgroundEditors.add(editor);
  return () => {
    playgroundEditors.delete(editor);
  };
}

export function isPlaygroundEditor(editor: Editor): boolean {
  return playgroundEditors.has(editor);
}
