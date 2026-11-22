import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { DecorationSet } from "@tiptap/pm/view";

export interface DecorationLayer {
  /** The layer's name, e.g. "comments" or "find". */
  name: string;
  /**
   * Map the set through document changes (`DecorationSet.map`) instead of
   * clearing it. Comments map; hits that are recomputed anyway clear.
   */
  map?: boolean;
}

export interface DecorationHostOptions {
  layers: DecorationLayer[];
}

/** The meta every layer reads: `{ name, set }`. */
const LAYER_META = "decorationLayer";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    decorationHost: {
      /**
       * Shows `set` (built against the current document) as layer `name`;
       * `DecorationSet.empty` clears it. Meta-only: never the document, Yjs
       * or undo.
       */
      setDecorationLayer: (name: string, set: DecorationSet) => ReturnType;
    };
  }
}

/**
 * Decoration host (details spec §1 rule 6), the `action-preview` pattern
 * made general: each declared layer is one eager plugin whose only state
 * is a `DecorationSet`, set by the meta-only `setDecorationLayer` command.
 * All logic (finding hits, anchoring comments) lives in the layer's lazy
 * chunk, which never calls `registerPlugin` (that re-creates every plugin
 * view): a layer is declared here, in the extensions array, once. A local
 * or remote document change maps a `map: true` layer and clears the rest.
 */
export const DecorationHost = Extension.create<DecorationHostOptions>({
  name: "decorationHost",

  addOptions: () => ({ layers: [] }),

  addCommands: () => ({
    setDecorationLayer:
      (name, set) =>
      ({ tr }) => {
        // No steps, so no history entry and nothing for Yjs.
        tr.setMeta(LAYER_META, { name, set });
        return true;
      },
  }),

  addProseMirrorPlugins() {
    return this.options.layers.map(
      ({ name, map }) =>
        new Plugin<DecorationSet>({
          state: {
            init: () => DecorationSet.empty,
            apply(tr, set) {
              const next = tr.getMeta(LAYER_META);
              if (next?.name === name) return next.set;
              // Mapping or clearing an empty set returns it unchanged.
              if (!tr.docChanged) return set;
              return map ? set.map(tr.mapping, tr.doc) : DecorationSet.empty;
            },
          },
          props: {
            decorations(state) {
              return this.getState(state);
            },
          },
        }),
    );
  },
});
