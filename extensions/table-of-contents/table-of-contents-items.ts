import type { Editor } from "@tiptap/core";
import {
  type GetTableOfContentIndexFunction,
  type GetTableOfContentLevelFunction,
  getHeadlineLevel,
  getLinearIndexes,
  type TableOfContentData,
  type TableOfContentDataItem,
} from "@tiptap/extension-table-of-contents";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

type CollectOptions = {
  anchorTypes: readonly string[];
  getLevel?: GetTableOfContentLevelFunction;
  getIndex?: GetTableOfContentIndexFunction;
};

/**
 * Table of contents items from the document alone: no layout reads, so it
 * is safe to run after every change. Text blocks that are not anchors are
 * skipped without walking their inline content.
 */
export function collectTocItems(
  editor: Editor,
  {
    anchorTypes,
    getLevel = getHeadlineLevel,
    getIndex = getLinearIndexes,
  }: CollectOptions,
): TableOfContentData {
  const items: TableOfContentDataItem[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (!anchorTypes.includes(node.type.name)) return !node.isTextblock;
    if (node.textContent.length > 0) {
      const headline = { node, pos };
      const level = getLevel(headline, items);
      items.push({
        itemIndex: getIndex(headline, items, level),
        id: node.attrs["data-toc-id"],
        originalLevel: node.attrs.level,
        level,
        textContent: node.textContent,
        pos,
        editor,
        isActive: false,
        isScrolledOver: false,
        node,
        dom: editor.view.nodeDOM(pos) as HTMLHeadingElement,
      });
    }
    return false;
  });
  return items;
}

export type ActiveState = { items: TableOfContentData; key: string };

/**
 * Marks the last heading at or above `scrollPosition` active and every
 * heading above it scrolled over (the stock extension's semantics). Reads
 * `offsetTop` in one batch, so layout is computed at most once.
 */
export function applyActiveState(
  items: TableOfContentData,
  scrollPosition: number,
): ActiveState {
  let activeIndex = -1;
  items.forEach((item, index) => {
    if (item.dom && scrollPosition >= item.dom.offsetTop) activeIndex = index;
  });
  return {
    items: items.map((item, index) => ({
      ...item,
      isActive: index === activeIndex,
      isScrolledOver: index <= activeIndex,
    })),
    key: activeIndex === -1 ? "" : `${items[activeIndex]?.id}:${activeIndex}`,
  };
}

/**
 * Whether two item lists render the same outline: same headings, text,
 * levels, numbering and active state. Positions and DOM nodes are ignored,
 * since they move with every edit above a heading; resolve them on use with
 * {@link findTocAnchor}.
 */
export function sameTocItems(
  a: TableOfContentData,
  b: TableOfContentData,
): boolean {
  return (
    a.length === b.length &&
    a.every((item, index) => {
      const other = b[index];
      return (
        item.id === other.id &&
        item.textContent === other.textContent &&
        item.level === other.level &&
        item.originalLevel === other.originalLevel &&
        item.itemIndex === other.itemIndex &&
        item.isActive === other.isActive &&
        item.isScrolledOver === other.isScrolledOver
      );
    })
  );
}

/** The anchor node carrying TOC id `id` and its position, if any. */
export function findTocAnchor(
  doc: ProseMirrorNode,
  id: string,
): { node: ProseMirrorNode; pos: number } | null {
  let found: { node: ProseMirrorNode; pos: number } | null = null;
  doc.descendants((node, pos) => {
    if (found) return false;
    if (node.attrs["data-toc-id"] === id) {
      found = { node, pos };
      return false;
    }
    return !node.isTextblock;
  });
  return found;
}
