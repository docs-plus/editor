import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { yUndoPluginKey } from "@tiptap/y-tiptap";

import {
  closeSlash,
  getSlashState,
} from "@/extensions/slash-trigger/slash-trigger";
import { editorActions } from "@/lib/editor-actions";
import { canRun, runAction } from "@/lib/editor-actions/registry";
import { computeContext } from "@/lib/editor-context/snapshot";
import type { SlashItem } from "@/lib/slash-menu/slash-items";

interface UndoManagerLike {
  stopCapturing(): void;
}

const undoManagerOf = (editor: Editor) =>
  (yUndoPluginKey.getState(editor.state)?.undoManager as
    | UndoManagerLike
    | undefined) ?? null;

/**
 * Runs a "/" menu pick as one undo step: removes the typed "/query",
 * then runs the action through `runAction` (which rechecks the live
 * document). `stopCapturing()` before and after keeps the typing before
 * and after it apart; the sync plugin writes each transaction to Yjs as
 * it is dispatched, so both land in one capture. If the action refuses
 * after the text is gone, the text goes back in the same capture and the
 * caret after it, so nothing changes. Returns whether the action ran.
 */
export function runSlashPick(editor: Editor, item: SlashItem): boolean {
  const state = getSlashState(editor);
  const action = editorActions.get(item.actionId);
  if (!state.open) return false;
  if (!action || !canRun(action, computeContext(editor))) {
    closeSlash(editor);
    return false;
  }
  const from = state.from;
  const to = from + 1 + state.query.length;
  const typed = editor.state.doc.slice(from, to);
  const undo = undoManagerOf(editor);
  undo?.stopCapturing();
  editor.view.dispatch(
    // Without its "/" the trigger closes.
    editor.state.tr.delete(from, to),
  );
  const ok = runAction(editor, action, item.arg);
  if (!ok) {
    const tr = editor.state.tr.replace(from, from, typed);
    editor.view.dispatch(
      tr.setSelection(TextSelection.create(tr.doc, from + typed.size)),
    );
  }
  undo?.stopCapturing();
  return ok;
}
