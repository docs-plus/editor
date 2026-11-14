import { Extension } from "@tiptap/core";
import { isChangeOrigin } from "@tiptap/extension-collaboration";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Attributes of the inline decoration a preview draws over each selection
 * range: the real mark's `data-*` token (styled by the existing token CSS),
 * a `class`, and `nodeName` ("mark" for highlights, else a span).
 */
export type PreviewAttrs = Readonly<Record<string, string>>;

export const actionPreviewKey = new PluginKey<DecorationSet>("actionPreview");

/** One inline decoration per selection range; `attrs` doubles as its spec. */
const build = (state: EditorState, attrs: PreviewAttrs) =>
  DecorationSet.create(
    state.doc,
    state.selection.ranges.map(({ $from, $to }) =>
      Decoration.inline($from.pos, $to.pos, attrs, attrs),
    ),
  );

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    actionPreview: {
      /** Shows `attrs` over the selection, or clears with null. */
      setActionPreview: (attrs: PreviewAttrs | null) => ReturnType;
    };
  }
}

/**
 * Hover preview (smart toolbar later phase): shows what a colour swatch
 * would do to the selection before it is applied. Decorations only: the
 * command's transaction is meta-only (no steps, selection or stored marks,
 * `addToHistory: false`), so it never reaches the document, Yjs, the undo
 * stack or the toolbar's version store. A local doc or selection change
 * clears it; a collaborator's change redraws it on the moved selection
 * (nothing is mapped), so it survives a busy shared document. The swatch side (gates, dwell, caps) lives in the
 * lazy colour-panel chunk and calls only the command, so it imports
 * nothing from the editor chunk. Registered once in the extensions array:
 * registering a plugin later re-creates every plugin view.
 */
export const ActionPreview = Extension.create({
  name: "actionPreview",

  addCommands() {
    return {
      setActionPreview:
        (attrs) =>
        ({ tr, state }) => {
          // Clearing with nothing shown: no transaction at all.
          if (
            !attrs &&
            actionPreviewKey.getState(state) === DecorationSet.empty
          ) {
            tr.setMeta("preventDispatch", true);
          } else {
            tr.setMeta(actionPreviewKey, attrs).setMeta("addToHistory", false);
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: actionPreviewKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, set, _old, state) {
            const attrs: PreviewAttrs | null | undefined =
              tr.getMeta(actionPreviewKey);
            if (attrs !== undefined) {
              return attrs ? build(state, attrs) : DecorationSet.empty;
            }
            if (set === DecorationSet.empty) return set;
            if (!tr.docChanged && !tr.selectionSet) return set;
            // A collaborator's change: redraw on the selection it moved,
            // never map the old ranges. A local change or selection clears.
            const shown: PreviewAttrs | undefined = set.find()[0]?.spec;
            return isChangeOrigin(tr) && shown
              ? build(state, shown)
              : DecorationSet.empty;
          },
        },
        props: {
          decorations: (state) => actionPreviewKey.getState(state),
        },
      }),
    ];
  },
});
