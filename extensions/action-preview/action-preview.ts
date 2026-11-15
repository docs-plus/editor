import { Extension } from "@tiptap/core";
import { isChangeOrigin } from "@tiptap/extension-collaboration";
import { type EditorState, Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Attributes of the inline decoration a preview draws over the selection:
 * the real mark's `data-*` token (styled by the existing token CSS), a
 * `class`, and `nodeName` ("mark" for highlights, else a span).
 */
export type PreviewAttrs = Readonly<Record<string, string>>;

/**
 * A preview: `attrs` over the selection wherever applying `mark` (a mark
 * name, e.g. "textColor") would change the text, and nowhere else.
 */
export interface PreviewSpec {
  readonly attrs: PreviewAttrs;
  readonly mark: string;
}

export const actionPreviewKey = new PluginKey<DecorationSet>("actionPreview");

/**
 * Inline decorations over the inline nodes of each selection range that
 * applying the mark changes, decided by the schema as `addMark` decides:
 * the parent allows the mark (a code block allows none) and no mark on the
 * node excludes it (inline code excludes all; `Mark.addToSet`). Adjacent
 * nodes share one decoration; `spec` doubles as its spec.
 */
const build = (state: EditorState, spec: PreviewSpec) => {
  const type = state.schema.marks[spec.mark];
  const runs: number[][] = [];
  for (const { $from, $to } of state.selection.ranges) {
    state.doc.nodesBetween($from.pos, $to.pos, (node, pos, parent) => {
      if (
        !node.isInline ||
        !parent?.type.allowsMarkType(type) ||
        node.marks.some((m) => m.type.excludes(type) && !type.excludes(m.type))
      ) {
        return;
      }
      const from = Math.max(pos, $from.pos);
      const to = Math.min(pos + node.nodeSize, $to.pos);
      const last = runs[runs.length - 1];
      if (last?.[1] === from) last[1] = to;
      else runs.push([from, to]);
    });
  }
  return DecorationSet.create(
    state.doc,
    runs.map(([from, to]) => Decoration.inline(from, to, spec.attrs, spec)),
  );
};

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    actionPreview: {
      /** Shows `preview` over the selection, or clears with null. */
      setActionPreview: (preview: PreviewSpec | null) => ReturnType;
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
        (preview) =>
        ({ tr, state }) => {
          // Clearing with nothing shown: no transaction at all.
          if (
            !preview &&
            actionPreviewKey.getState(state) === DecorationSet.empty
          ) {
            tr.setMeta("preventDispatch", true);
          } else {
            tr.setMeta(actionPreviewKey, preview).setMeta(
              "addToHistory",
              false,
            );
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
            const preview: PreviewSpec | null | undefined =
              tr.getMeta(actionPreviewKey);
            if (preview !== undefined) {
              return preview ? build(state, preview) : DecorationSet.empty;
            }
            if (set === DecorationSet.empty) return set;
            if (!tr.docChanged && !tr.selectionSet) return set;
            // A collaborator's change: redraw on the selection it moved,
            // never map the old ranges. A local change or selection clears.
            const shown: PreviewSpec | undefined = set.find()[0]?.spec;
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
