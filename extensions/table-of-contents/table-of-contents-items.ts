import type { Editor } from "@tiptap/core";
import {
  type GetTableOfContentIndexFunction,
  type GetTableOfContentLevelFunction,
  getHeadlineLevel,
  getLinearIndexes,
  type TableOfContentData,
  type TableOfContentDataItem,
} from "@tiptap/extension-table-of-contents";

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
