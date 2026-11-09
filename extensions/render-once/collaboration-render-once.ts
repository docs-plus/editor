import { Extension } from "@tiptap/core";
import {
  Collaboration,
  type CollaborationOptions,
} from "@tiptap/extension-collaboration";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { ySyncPluginKey } from "@tiptap/y-tiptap";

/**
 * Makes the y-tiptap sync plugin's view skip updates that leave the
 * document alone. Its `update` writes the editor document to Yjs on every
 * view update, comparing every top-level block with the Yjs fragment
 * inside a Yjs transaction, though only a new document can need writing.
 * Selection moves and meta-only transactions (the collaboration-caret
 * plugin dispatches one after every local keystroke) skip that pass.
 */
function syncOnDocumentChange(plugin: Plugin): void {
  const createView = plugin.spec.view;
  if (!createView) return;
  plugin.spec.view = (editorView: EditorView) => {
    const pluginView = createView(editorView);
    return {
      update: (view: EditorView, prevState: EditorState) => {
        if (view.state.doc !== prevState.doc) {
          pluginView.update?.(view, prevState);
        }
      },
      destroy: () => pluginView.destroy?.(),
    };
  };
}

/** `Collaboration` whose sync plugin skips updates that change no content. */
const CollaborationSyncOnDocChange = Collaboration.extend({
  addProseMirrorPlugins() {
    const plugins = this.parent?.() ?? [];
    for (const plugin of plugins) {
      if (plugin.spec.key === ySyncPluginKey) syncOnDocumentChange(plugin);
    }
    return plugins;
  },
});

/**
 * `Collaboration` that builds the editor document from Yjs once per editor.
 * Takes the same options and registers the stock extension underneath.
 *
 * y-tiptap's sync plugin rebuilds the whole ProseMirror document from the
 * Yjs fragment every time ProseMirror re-creates plugin views, which happens
 * on every `registerPlugin` call; Tiptap's `EditorContent` makes one when it
 * mounts. On a large document that second pass costs a full document build
 * and decoration pass (code highlighting included), and because the rebuilt
 * document is equal but not identical, every later view update deep-compares
 * the whole document until the first edit.
 *
 * Handing the sync plugin a mapping of its own switches that automatic
 * re-render off; this extension renders once instead, from a plugin view
 * that runs right after the sync plugin's (Collaboration has priority 1000,
 * this extension the default 100). Remote changes keep arriving through the
 * binding's Yjs observers, which do not depend on plugin views.
 *
 * The sync plugin's view also skips updates that leave the document alone
 * (see `syncOnDocumentChange`).
 */
export const CollaborationRenderOnce = Extension.create<CollaborationOptions>({
  name: "collaborationRenderOnce",

  addOptions() {
    return {
      document: null,
      field: "default",
      fragment: null,
      provider: null,
    };
  },

  addExtensions() {
    return [
      CollaborationSyncOnDocChange.configure({
        ...this.options,
        // The sync plugin would call this on every plugin-view init; it runs
        // once, after the render below, instead.
        onFirstRender: undefined,
        ySyncOptions: { ...this.options.ySyncOptions, mapping: new Map() },
      }),
    ];
  },

  addProseMirrorPlugins() {
    const { onFirstRender } = this.options;
    let rendered = false;
    return [
      new Plugin({
        key: new PluginKey("collaborationRenderOnce"),
        view: (view) => {
          if (!rendered) {
            rendered = true;
            ySyncPluginKey.getState(view.state)?.binding?._forceRerender();
            onFirstRender?.();
          }
          return {};
        },
      }),
    ];
  },
});
