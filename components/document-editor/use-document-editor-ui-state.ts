"use client";

import type { TableOfContentData } from "@tiptap/extension-table-of-contents";
import { useState, useSyncExternalStore } from "react";

export interface TocItemsStore {
  set: (items: TableOfContentData) => void;
  subscribe: (listener: () => void) => () => void;
  get: () => TableOfContentData;
}

function createTocItemsStore(): TocItemsStore {
  let items: TableOfContentData = [];
  let pending: TableOfContentData = items;
  let scheduled = false;
  const listeners = new Set<() => void>();
  return {
    // The editor reports items from inside its own updates, which can run
    // while React renders, so listeners hear about them a microtask later.
    set(next) {
      pending = next;
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        scheduled = false;
        items = pending;
        for (const listener of listeners) listener();
      });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => items,
  };
}

/**
 * Outline items, kept outside React state: an outline change (typing in a
 * heading) re-renders only the components that read the items through
 * {@link useTocItems}, not the whole editor shell.
 */
export function useTocItemsStore(): TocItemsStore {
  const [store] = useState(createTocItemsStore);
  return store;
}

export function useTocItems(store: TocItemsStore): TableOfContentData {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
