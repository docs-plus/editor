import type { Editor } from "@tiptap/core";

import type { AnyAction, Enabled } from "@/lib/editor-actions/types";
import { emitUiIntent } from "@/lib/editor-actions/ui-intents";

/**
 * Comments (P4.9, contract A19). Prefix `comment.`. The comments design
 * §11.1 entry points (bubble, menu, palette) all run `comment.add`; the
 * draft card that answers it is P4.10's. No icon and no keywords yet:
 * within P4.9's 150 B ledger line they don't fit (the lucide
 * `MessageSquarePlus` icon alone measured 141 B gz); the bubble's 💬
 * (bubble design P5) adds the icon on its own line.
 */

const gates = new WeakMap<Editor, () => boolean>();

/**
 * Marks `editor` as one whose document takes comments, with its
 * `canComment()` gate (comments design §6.2); returns the unmark. Nothing
 * on the web sandbox or the Playground calls it, so there the action is
 * neither offered nor enabled.
 */
export function setCommentGate(
  editor: Editor,
  canComment: () => boolean,
): () => void {
  gates.set(editor, canComment);
  return () => {
    if (gates.get(editor) === canComment) gates.delete(editor);
  };
}

const commentGate = (editor: Editor) => gates.get(editor)?.() ?? false;

const NO_COMMENTS: Enabled = { reason: "Comments aren't available here." };

const addCommentAction: AnyAction = {
  id: "comment.add",
  label: "Comment",
  group: "insert",
  contexts: "any",
  // Not a text edit: reading mode allows comments and `canComment()`, not
  // the central read-only gate, refuses view links (§6.2).
  mutates: false,
  offered: (ctx) => ctx.can("comment", commentGate),
  enabled: (ctx) => (ctx.can("comment", commentGate) ? true : NO_COMMENTS),
  run: (editor) =>
    commentGate(editor) && emitUiIntent(editor, { type: "comment.add" }),
};

export const commentActions: readonly AnyAction[] = [addCommentAction];
