import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { yUndoPluginKey } from "@tiptap/y-tiptap";

import { getSlashState } from "@/extensions/slash-trigger/slash-trigger";

/**
 * The "/" that the `+` on an empty line types (spec §8.2).
 *
 * The `+` types an ordinary "/", in the history like a typed one, so the
 * query, a pick, Esc and undo all behave exactly as after a typed "/"
 * (a pick after "/ta" undoes to "/ta"). The one difference: closing or
 * picking with the query still empty takes that "/" back out of the
 * history, as if it had never been typed. Esc leaves no undo step, and
 * a pick undoes to the empty line.
 *
 * One record per page, in the slash chunk only. The `+` (bubble chunk)
 * reaches this module through `import("…/slash/slash-menu")`, never
 * statically, because a static import would give the bubble chunk its
 * own copy of this state. The record is dropped the moment the trigger
 * closes or its query stops being empty, whether or not the menu ever
 * mounted. A "/" typed later is never taken for it.
 */

export interface UndoManagerLike {
  stopCapturing(): void;
  undo(): unknown;
  readonly undoStack: readonly unknown[];
  readonly redoStack: unknown[];
}

/** The collaborative undo manager, if the editor has one. */
export const undoManagerOf = (editor: Editor): UndoManagerLike | null =>
  (yUndoPluginKey.getState(editor.state)?.undoManager as
    | UndoManagerLike
    | undefined) ?? null;

let plus: {
  editor: Editor;
  /** The undo step that typed the "/", or null without a Yjs history. */
  step: unknown;
  follow: () => void;
} | null = null;

function clear(): void {
  plus?.editor.off("transaction", plus.follow);
  plus = null;
}

/**
 * Types "/" at the start of the empty paragraph at `line`, as its own
 * undo step, and records it while the menu it opens has an empty query.
 */
export function typePlusSlash(editor: Editor, line: number): void {
  clear();
  const { view } = editor;
  // The hover path may find the editor blurred; a blur closes the menu.
  view.focus();
  const undo = undoManagerOf(editor);
  undo?.stopCapturing();
  const { tr } = view.state;
  tr.setSelection(TextSelection.create(tr.doc, line + 1)).insertText("/");
  // Without a Yjs history, keep it out of ProseMirror's (removed the same way).
  if (!undo) tr.setMeta("addToHistory", false);
  view.dispatch(tr);
  undo?.stopCapturing();
  const state = getSlashState(editor);
  if (!state.open) return;
  const follow = () => {
    const now = getSlashState(editor);
    if (!now.open || now.query) clear();
  };
  editor.on("transaction", follow);
  plus = { editor, step: undo?.undoStack.at(-1) ?? null, follow };
}

/** Whether the open menu's empty-query "/" is the one the `+` typed. */
export function isPlusSlash(editor: Editor): boolean {
  const state = getSlashState(editor);
  return plus?.editor === editor && state.open && !state.query;
}

/**
 * Takes the `+`'s "/" out again, out of the history too: its own undo step
 * is undone and dropped while it is still the latest one (nothing else
 * local happened since). Otherwise the "/" is deleted outside the history.
 */
export function removePlusSlash(editor: Editor): void {
  const state = getSlashState(editor);
  if (!plus || !isPlusSlash(editor) || !state.open) return;
  const undo = undoManagerOf(editor);
  const { step } = plus;
  clear();
  if (undo && step && undo.undoStack.at(-1) === step) {
    undo.undo();
    undo.redoStack.pop();
    // The undo put the caret back where it was before the click; keep it
    // in the line (a pick runs there), and refresh the undo plugin's
    // `hasRedoOps`, which it recomputes on every transaction.
    const { tr } = editor.state;
    const at = Math.min(state.from, tr.doc.content.size);
    if (tr.doc.resolve(at).parent.inlineContent) {
      tr.setSelection(TextSelection.create(tr.doc, at));
    }
    editor.view.dispatch(tr.setMeta("addToHistory", false));
    return;
  }
  editor.view.dispatch(
    editor.state.tr
      .delete(state.from, state.from + 1)
      .setMeta("addToHistory", false),
  );
}
