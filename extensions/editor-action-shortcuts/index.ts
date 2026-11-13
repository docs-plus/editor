import { Extension } from "@tiptap/core";

import { editorActions } from "@/lib/editor-actions";
import { runAction } from "@/lib/editor-actions/registry";
import { emitUiIntent } from "@/lib/editor-actions/ui-intents";

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
      "Alt-F10": () => emitUiIntent(this.editor, { type: "toolbar.focus" }),
    };
  },
});
