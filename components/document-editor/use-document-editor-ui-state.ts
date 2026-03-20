"use client";

import type { TableOfContentData } from "@tiptap/extension-table-of-contents";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

export function useToolbarHeight(toolbarRef: RefObject<HTMLDivElement | null>) {
  const [toolbarHeight, setToolbarHeight] = useState(0);

  useEffect(() => {
    if (!toolbarRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setToolbarHeight(entry.contentRect.height);
      }
    });
    ro.observe(toolbarRef.current);
    return () => ro.disconnect();
  }, [toolbarRef]);

  return toolbarHeight;
}

export function useDebouncedTocItems() {
  const [tocItems, setTocItems] = useState<TableOfContentData>([]);
  const tocPendingRef = useRef(false);
  const tocLatestRef = useRef<TableOfContentData>([]);

  const updateTocItems = useCallback((items: TableOfContentData) => {
    tocLatestRef.current = items;
    if (tocPendingRef.current) return;
    tocPendingRef.current = true;
    queueMicrotask(() => {
      tocPendingRef.current = false;
      setTocItems(tocLatestRef.current);
    });
  }, []);

  return { tocItems, updateTocItems };
}
