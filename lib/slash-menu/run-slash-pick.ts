import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { yUndoPluginKey } from "@tiptap/y-tiptap";

import {
  closeSlash,
  getSlashState,
} from "@/extensions/slash-trigger/slash-trigger";
import { announceLater } from "@/lib/announce-later";
import { editorActions } from "@/lib/editor-actions";
import { availability, runAction } from "@/lib/editor-actions/registry";
import type { AnyAction } from "@/lib/editor-actions/types";
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
 * Why `action` cannot run on the live document, as the menu's own note
 * says it ("Quote: Already in a quote.", `slashEmptyNote`), or null.
 */
function refusal(editor: Editor, item: SlashItem, action: AnyAction) {
  const enabled = availability(action, computeContext(editor));
  return enabled === true ? null : `${item.label}: ${enabled.reason}`;
}

/**
 * Runs a "/" menu pick as one undo step: removes the typed "/query",
 * then runs the action through `runAction` (which rechecks the live
 * document). `stopCapturing()` before and after keeps the typing before
 * and after it apart; the sync plugin writes each transaction to Yjs as
 * it is dispatched, so both land in one capture. If the action refuses
 * after the text is gone, the text goes back in the same capture and the
 * caret after it, so nothing changes. Returns whether the action ran.
 *
 * Rows are only what could run when the menu opened, so a refusal means
 * the document changed since (a collaborator's edit, a shortcut): the
 * status pill says why (design pass §5) through `announceLater`, whose
 * announcer chunk is preloaded on idle, so this chunk does not carry its
 * own copy. A run that was allowed but did nothing, or a missing action
 * (a bug), says nothing.
 */
export function runSlashPick(editor: Editor, item: SlashItem): boolean {
  const state = getSlashState(editor);
  const action = editorActions.get(item.actionId);
  if (!state.open) return false;
  const refused = action ? refusal(editor, item, action) : null;
  if (!action || refused) {
    closeSlash(editor);
    if (refused) announceLater(refused);
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
    // Judged on the document the run saw, before the text goes back.
    const why = refusal(editor, item, action);
    const tr = editor.state.tr.replace(from, from, typed);
    editor.view.dispatch(
      tr.setSelection(TextSelection.create(tr.doc, from + typed.size)),
    );
    if (why) announceLater(why);
  }
  undo?.stopCapturing();
  return ok;
}
