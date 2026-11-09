import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";

import { changedRanges, rangesTouchNode } from "@/extensions/shared";

export const tocIdPluginKey = new PluginKey("tableOfContentIds");

interface TocIdPluginOptions {
  anchorTypes: readonly string[];
  getId?: (textContent: string) => string;
}

/**
 * Same ids as the stock `TableOfContentsPlugin`: every non-empty anchor
 * carries a `data-toc-id` (mirrored to `id`) that no earlier anchor uses.
 *
 * The stock plugin walks every node of the document, inline content
 * included, and reads each node's `textContent`, after every change. Here,
 * changes that touch no anchor (typing in body text) cost a look at the
 * changed ranges only, and the walk skips the content of text blocks.
 */
export function createTocIdPlugin({ anchorTypes, getId }: TocIdPluginOptions) {
  const isAnchor = (node: ProseMirrorNode) =>
    anchorTypes.includes(node.type.name);

  return new Plugin({
    key: tocIdPluginKey,
    appendTransaction(transactions, _oldState, newState) {
      if (typeof window === "undefined") return null;
      // Leave IME composition alone, as the stock plugin does.
      if (transactions.some((tr) => tr.getMeta("composition"))) return null;
      const changed = transactions.filter((tr) => tr.docChanged);
      if (changed.length === 0) return null;
      const ranges = changedRanges(changed);
      if (ranges && !rangesTouchNode(newState.doc, ranges, isAnchor)) {
        return null;
      }

      const { tr } = newState;
      const seen = new Set<unknown>();
      newState.doc.descendants((node, pos) => {
        if (!isAnchor(node)) return !node.isTextblock;
        if (node.textContent.length === 0) return false;
        const id = node.attrs["data-toc-id"];
        if (id === null || id === undefined || seen.has(id)) {
          const next = getId?.(node.textContent) ?? crypto.randomUUID();
          tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            "data-toc-id": next,
            id: next,
          });
        }
        seen.add(id);
        return false;
      });
      return tr.docChanged ? tr : null;
    },
  });
}
