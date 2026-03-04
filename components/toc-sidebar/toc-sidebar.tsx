"use client";

import type { Editor } from "@tiptap/core";
import type { TableOfContentData } from "@tiptap/extension-table-of-contents";
import { useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/tiptap-utils";

import "./toc-sidebar.scss";

interface TOCSidebarProps {
  items: TableOfContentData;
  editor: Editor | null;
}

export function TOCSidebar({ items, editor }: TOCSidebarProps) {
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

  return (
    <nav className="toc-sidebar" aria-label="Document outline">
      <div className="toc-sidebar-header">Outline</div>
      {items.length === 0 ? (
        <p className="toc-sidebar-empty">Add headings to see an outline</p>
      ) : (
        <div className="toc-sidebar-items">
          {items.map((item) => (
            <button
              type="button"
              key={item.id}
              ref={item.isActive ? activeRef : undefined}
              className={cn(
                "toc-sidebar-item",
                item.isActive && "toc-sidebar-item--active",
                item.isScrolledOver && "toc-sidebar-item--scrolled",
              )}
              style={{ paddingLeft: `${10 + (item.level - 1) * 12}px` }}
              onClick={() => handleClick(item)}
            >
              {item.textContent}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
}
