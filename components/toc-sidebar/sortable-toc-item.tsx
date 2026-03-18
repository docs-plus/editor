"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TableOfContentData } from "@tiptap/extension-table-of-contents";
import { memo, type RefObject } from "react";

import { ChevronRightIcon, GripVerticalIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

type TocItem = TableOfContentData[number];

export interface SortableTocItemProps {
  item: TocItem;
  idx: number;
  isTitle: boolean;
  isFoldable: boolean;
  isFolded: boolean;
  isFiltering: boolean;
  isPreviewing: boolean;
  filteredIds?: Set<string>;
  previewMatchIds?: Set<string>;
  activeRef: RefObject<HTMLButtonElement | null>;
  onToggleFold: (id: string) => void;
  onClick: (item: TocItem) => void;
}

export const SortableTocItem = memo(function SortableTocItem({
  item,
  idx,
  isTitle,
  isFoldable,
  isFolded,
  isFiltering,
  isPreviewing,
  filteredIds,
  previewMatchIds,
  activeRef,
  onToggleFold,
  onClick,
}: SortableTocItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isSorting,
    isOver,
    activeIndex,
    index,
  } = useSortable({ id: item.id, disabled: isTitle });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
  };

  const showIndicatorAbove = isOver && isSorting && activeIndex > index;
  const showIndicatorBelow = isOver && isSorting && activeIndex < index;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "toc-sidebar-item-row",
        item.level === 1 && idx > 0 && "toc-sidebar-item-row--h1",
        isDragging && "toc-sidebar-item-row--dragging",
        showIndicatorAbove && "toc-sidebar-item-row--indicator-above",
        showIndicatorBelow && "toc-sidebar-item-row--indicator-below",
      )}
      role="treeitem"
      tabIndex={0}
      aria-level={item.level}
      aria-expanded={isFoldable ? !isFolded : undefined}
      data-level={item.level}
      data-toc-id={item.id}
    >
      {!isTitle && (
        <span
          className="toc-sidebar-drag-handle"
          {...attributes}
          {...listeners}
          role="button"
          tabIndex={0}
          aria-label="Drag to reorder"
        >
          <GripVerticalIcon size={12} />
        </span>
      )}
      {isFoldable ? (
        <button
          type="button"
          className={cn(
            "toc-sidebar-fold-toggle",
            isFolded && "toc-sidebar-fold-toggle--folded",
          )}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFold(item.id);
          }}
          aria-label={isFolded ? "Expand section" : "Collapse section"}
        >
          <ChevronRightIcon className="toc-sidebar-fold-icon" />
        </button>
      ) : (
        <span className="toc-sidebar-fold-spacer" />
      )}
      <button
        type="button"
        ref={item.isActive ? activeRef : undefined}
        className={cn(
          "toc-sidebar-item",
          item.isActive && "toc-sidebar-item--active",
          item.isScrolledOver && "toc-sidebar-item--scrolled",
          isFiltering &&
            filteredIds &&
            !filteredIds.has(item.id) &&
            "toc-sidebar-item--dimmed",
          isPreviewing &&
            previewMatchIds?.has(item.id) &&
            "toc-sidebar-item--preview-match",
        )}
        style={{ paddingLeft: `${(item.level - 1) * 12}px` }}
        onClick={() => onClick(item)}
      >
        {item.textContent}
      </button>
    </div>
  );
});
