import { Extension } from "@tiptap/core";
import type { EditorView } from "@tiptap/pm/view";

import { editorActions } from "@/lib/editor-actions";
import { runAction } from "@/lib/editor-actions/registry";
import { emitUiIntent } from "@/lib/editor-actions/ui-intents";

/**
 * ProseMirror reads native selection changes (Shift+Arrow) on the async
 * `selectionchange` event. Leaving for the toolbar before it fires would
 * keep a stale selection, which Esc then restores; read it now.
 */
function flushDomSelection(view: EditorView): void {
  (view as unknown as { domObserver?: { flush(): void } }).domObserver?.flush();
}

/**
 * D1's keys (contract §3.4): each key is bound by exactly one extension.
 * - `Mod-\` runs `format.clear` through the registry gate (read-only safe).
 * - `Alt-F10` asks the shell to move focus to the toolbar (the selection
 *   bubble when it is open, else the row); Esc there returns here.
 */
export const EditorActionShortcuts = Extension.create({
  name: "editorActionShortcuts",

  addKeyboardShortcuts() {
    return {
      "Mod-\\": () => {
        const clear = editorActions.get("format.clear");
        return clear ? runAction(this.editor, clear) : false;
      },
      "Alt-F10": () => {
        flushDomSelection(this.editor.view);
        return emitUiIntent(this.editor, { type: "toolbar.focus" });
      },
    };
  },
});
