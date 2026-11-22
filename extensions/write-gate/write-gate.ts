import { Extension } from "@tiptap/core";
import { isChangeOrigin } from "@tiptap/extension-collaboration";
import { Plugin } from "@tiptap/pm/state";

export interface WriteGateOptions {
  /**
   * Whether this window may change the document. Required. Read on every
   * transaction, so pass a function over a ref: it must not wait for
   * `setEditable`, which runs in an effect after the editor is created.
   */
  canWrite: () => boolean;
}

/**
 * Read-only enforced before a change exists (details spec §1 rules 1–2): a
 * Yjs update is never dropped once made (later updates from the same
 * client would strand), so a read-only document must not make one. Filters
 * every local transaction that changes the document while `canWrite()` is
 * false, appended ones included, so the plugins that write when a document
 * opens (heading ids, the title, the trailing node, the outline) are gated
 * too. Changes arriving from Yjs and meta-only transactions (folds,
 * previews, decorations) always pass. `setEditable` still blocks typing.
 */
export const WriteGate = Extension.create<WriteGateOptions>({
  name: "writeGate",

  addProseMirrorPlugins() {
    const { canWrite } = this.options;
    return [
      new Plugin({
        filterTransaction: (tr) =>
          !tr.docChanged || isChangeOrigin(tr) || canWrite(),
      }),
    ];
  },
});
