import type { Editor, EditorEvents } from "@tiptap/core";
import { TextSelection, type Transaction } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";
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
import { isPlusSlash } from "@/lib/slash-menu/plus-origin";
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
 * Runs `run` and returns what it returned, with the mapping from the
 * document before it to the one after, through every change dispatched
 * meanwhile (its own steps, a collaborator's edit, a wrap in a quote).
 * Changes are chained by the document each began from, not by the order
 * they were heard: a listener that dispatches from its own `transaction`
 * handler is heard before the change that set it off. The mapping is null
 * if they do not lead to the live document.
 */
function withMapping(editor: Editor, run: () => boolean) {
  const start = editor.state.doc;
  const heard: Transaction[] = [];
  const hear = (event: EditorEvents["transaction"]) => {
    for (const tr of [event.transaction, ...event.appendedTransactions]) {
      if (tr.docChanged) heard.push(tr);
    }
  };
  editor.on("transaction", hear);
  let ok: boolean;
  try {
    ok = run();
  } finally {
    editor.off("transaction", hear);
  }
  const mapping = new Mapping();
  let doc = start;
  for (let tr = heard.find((t) => t.before === doc); tr; ) {
    mapping.appendMapping(tr.mapping);
    doc = tr.doc;
    tr = heard.find((t) => t.before === doc);
  }
  return { ok, mapping: doc === editor.state.doc ? mapping : null };
}

/**
 * Runs a "/" menu pick as one undo step: removes the typed "/query",
 * then runs the action through `runAction` (which rechecks the live
 * document). `stopCapturing()` before and after keeps the typing before
 * and after it apart; the sync plugin writes each transaction to Yjs as
 * it is dispatched, so both land in one capture. If the action refuses
 * after the text is gone, the text goes back in the same capture and the
 * caret after it, so nothing changes: at its place mapped through any
 * change made in between. Returns whether the action ran.
 *
 * Rows are only what could run when the menu opened, so a refusal means
 * the document changed since (a collaborator's edit, a shortcut): the
 * status pill says why (design pass §5) through `announceLater`, whose
 * announcer chunk is preloaded on idle, so this chunk does not carry its
 * own copy. A run that was allowed but did nothing, or a missing action
 * (a bug), says nothing.
 *
 * A "/" the `+` typed outside the history (spec §8.2, `isPlusSlash`)
 * leaves the same way, so the pick's undo step holds only the query and
 * the block change.
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
  const typedByPlus = isPlusSlash(editor);
  const undo = undoManagerOf(editor);
  undo?.stopCapturing();
  if (typedByPlus) {
    editor.view.dispatch(
      editor.state.tr.delete(from, from + 1).setMeta("addToHistory", false),
    );
  }
  editor.view.dispatch(
    // Without its "/" the trigger closes.
    editor.state.tr.delete(from, typedByPlus ? to - 1 : to),
  );
  const { ok, mapping } = withMapping(editor, () =>
    runAction(editor, action, item.arg),
  );
  if (!ok) {
    // Judged on the document the run saw, before the text goes back.
    const why = refusal(editor, item, action);
    // Where the "/" was in the live document; nowhere if its line is gone.
    const at = mapping?.mapResult(from);
    const { doc } = editor.state;
    if (at && !at.deleted && doc.resolve(at.pos).parent.inlineContent) {
      const tr = editor.state.tr.replace(at.pos, at.pos, typed);
      editor.view.dispatch(
        tr.setSelection(TextSelection.create(tr.doc, at.pos + typed.size)),
      );
    }
    if (why) announceLater(why);
  }
  undo?.stopCapturing();
  return ok;
}
