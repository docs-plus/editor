import { Extension } from "@tiptap/core";

import { computeSection } from "@/extensions/shared";

import {
  createHeadingFoldPlugin,
  findSectionDom,
  headingFoldPluginKey,
  measureContentHeight,
} from "./heading-fold-plugin";
import { loadFoldedIds } from "./helpers/fold-storage";

export interface HeadingFoldOptions {
  documentId: string;
  onFoldChange?: (foldedIds: Set<string>) => void;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    headingFold: {
      toggleFold: (headingId: string) => ReturnType;
      /**
       * Unfolds, without animation, every folded section that contains the
       * heading (not its own fold), so it can be scrolled to at its true
       * position. False when the heading is gone.
       */
      unfoldAncestors: (headingId: string) => ReturnType;
    };
  }
}

export const HeadingFold = Extension.create<HeadingFoldOptions>({
  name: "headingFold",

  addOptions() {
    return {
      documentId: "default",
      onFoldChange: undefined,
    };
  },

  addCommands() {
    return {
      toggleFold:
        (headingId: string) =>
        ({ tr, dispatch, view }) => {
          if (!dispatch) return true;

          const state = headingFoldPluginKey.getState(view.state);
          if (state?.animating.has(headingId)) return true;

          const isFolded = state?.foldedIds.has(headingId) ?? false;

          if (!isFolded) {
            const { headingEl, contentNodes, nextSiblingEl } = findSectionDom(
              view,
              headingId,
            );
            if (!headingEl) return false;
            const contentHeight = measureContentHeight(
              headingEl,
              contentNodes,
              nextSiblingEl,
            );
            tr.setMeta(headingFoldPluginKey, {
              type: "toggle",
              id: headingId,
              contentHeight,
            });
          } else {
            tr.setMeta(headingFoldPluginKey, {
              type: "toggle",
              id: headingId,
            });
          }

          dispatch(tr);
          return true;
        },

      unfoldAncestors:
        (headingId: string) =>
        ({ state, tr, dispatch }) => {
          const { doc } = state;
          const fold = headingFoldPluginKey.getState(state);
          let target = -1;
          const sections: { id: string; pos: number; level: number }[] = [];
          doc.forEach((node, pos) => {
            if (target !== -1 || node.type.name !== "heading") return;
            const id = node.attrs["data-toc-id"] as string;
            if (id === headingId) target = pos;
            else if (fold?.foldedIds.has(id)) {
              sections.push({ id, pos, level: node.attrs.level as number });
            }
          });
          if (target === -1) return false;

          const hiding = sections.filter(
            ({ pos, level }) => computeSection(doc, pos, level).to > target,
          );
          if (!fold || hiding.length === 0 || !dispatch) return true;

          const ids = new Set(fold.foldedIds);
          for (const { id } of hiding) ids.delete(id);
          // A filter's folds are temporary (`skipPersist`); keep them so.
          tr.setMeta(headingFoldPluginKey, {
            type: "set",
            ids,
            persist: !fold.skipPersist,
          });
          dispatch(tr);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const initialFoldedIds = loadFoldedIds(this.options.documentId);
    return [
      createHeadingFoldPlugin({
        documentId: this.options.documentId,
        initialFoldedIds,
        onFoldChange: this.options.onFoldChange,
      }),
    ];
  },
});
