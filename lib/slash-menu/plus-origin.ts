import type { Editor } from "@tiptap/core";

import { getSlashState } from "@/extensions/slash-trigger/slash-trigger";

/**
 * Which "/" the `+` on an empty line typed (spec §8.2), so Esc and Close
 * on its empty query, and a pick, take that "/" out of the document the
 * way it came in: outside the undo history.
 *
 * One record per page, in the slash chunk only: the `+` (bubble chunk)
 * reaches it through `import("…/slash/slash-menu")`, never statically,
 * because a static import would give the bubble chunk its own copy of
 * this state. The record follows the trigger's own `from` (local steps
 * mapped, remote ones re-derived from the caret) and is dropped the
 * moment the trigger closes, whether or not the menu ever mounted, so a
 * "/" typed later is never taken for it.
 */
let plus: { editor: Editor; from: number; stop: () => void } | null = null;

function clear(): void {
  plus?.stop();
  plus = null;
}

/** The `+` typed the open menu's "/" (call right after its dispatch). */
export function markPlusSlash(editor: Editor): void {
  clear();
  const state = getSlashState(editor);
  if (!state.open) return;
  const follow = () => {
    const now = getSlashState(editor);
    if (plus && now.open) plus.from = now.from;
    else clear();
  };
  editor.on("transaction", follow);
  editor.on("destroy", clear);
  plus = {
    editor,
    from: state.from,
    stop: () => {
      editor.off("transaction", follow);
      editor.off("destroy", clear);
    },
  };
}

/** Whether the open menu's "/" is the one the `+` typed. */
export function isPlusSlash(editor: Editor): boolean {
  const state = getSlashState(editor);
  return plus?.editor === editor && state.open && plus.from === state.from;
}
