"use client";

import type { Editor } from "@tiptap/core";
import type { TableOfContentData } from "@tiptap/extension-table-of-contents";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { ChevronRightIcon } from "@/lib/icons";
import { cn } from "@/lib/tiptap-utils";

import "./toc-sidebar.scss";

interface TocSidebarProps {
  items: TableOfContentData;
  editor: Editor | null;
  foldedIds: Set<string>;
  onToggleFold: (id: string) => void;
}

function filterItemsByFoldState(
  items: TableOfContentData,
  foldedIds: Set<string>,
): { visible: TableOfContentData; foldableIds: Set<string> } {
  const visible: TableOfContentData = [];
  const foldableIds = new Set<string>();

  for (let i = 0; i < items.length; i++) {
    if (i === 0) continue;
    const next = items[i + 1];
    if (next && next.level > items[i].level) {
      foldableIds.add(items[i].id);
    }
  }

  const foldStack: number[] = [];

  for (const item of items) {
    while (
      foldStack.length > 0 &&
      item.level <= foldStack[foldStack.length - 1]
    ) {
      foldStack.pop();
    }

    if (foldStack.length > 0) continue;

    visible.push(item);

    if (foldedIds.has(item.id)) {
      foldStack.push(item.level);
    }
  }

  return { visible, foldableIds };
}

export function TocSidebar({
  items,
  editor,
  foldedIds,
  onToggleFold,
}: TocSidebarProps) {
  const activeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, []);

  const handleClick = useCallback(
    (item: TableOfContentData[number]) => {
      if (!editor) return;
      editor.commands.setTextSelection(item.pos + 1);
      item.dom.scrollIntoView({ behavior: "smooth", block: "center" });
      editor.commands.focus();
    },
    [editor],
  );

  const { visible, foldableIds } = useMemo(
    () => filterItemsByFoldState(items, foldedIds),
    [items, foldedIds],
  );

  return (
    <nav className="toc-sidebar" aria-label="Document outline">
      <div className="toc-sidebar-header">Outline</div>
      {items.length === 0 ? (
        <p className="toc-sidebar-empty">Add headings to see an outline</p>
      ) : (
        <div className="toc-sidebar-items">
          {visible.map((item) => {
            const isFoldable = foldableIds.has(item.id);
            const isFolded = foldedIds.has(item.id);

            return (
              <div key={item.id} className="toc-sidebar-item-row">
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
                    aria-label={
                      isFolded ? "Expand section" : "Collapse section"
                    }
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
                  )}
                  style={{ paddingLeft: `${(item.level - 1) * 12}px` }}
                  onClick={() => handleClick(item)}
                >
                  {item.textContent}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </nav>
  );
}
