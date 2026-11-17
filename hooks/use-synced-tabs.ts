"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { trackEvent } from "@/lib/analytics";
import { MAX_TABS_PER_CLIENT, PLAYGROUND_ID } from "@/lib/constants";
import type {
  DocumentIndex,
  DocumentIndexListener,
} from "@/lib/platform/document-index";
import { createGlobalTabsIndex } from "@/lib/platform/web/global-tabs-index";
import {
  loadActiveTabIdFromStorage,
  persistActiveTabId,
  resolveActiveTabId,
} from "@/lib/tab-api";
import type { Tab } from "@/lib/tab-entry";
import type { RestorableTab, TabList } from "@/lib/tab-restore";

export type { Tab } from "@/lib/tab-entry";
export type { RestorableTab } from "@/lib/tab-restore";

/** Undo and restore live in a lazy chunk, fetched on the first close. */
const loadTabRestore = () => import("@/lib/tab-restore");

export interface UseSyncedTabsReturn {
  ready: boolean;
  tabs: Tab[];
  activeTabId: string;
  canCreateTab: boolean;
  createTabLimitMessage: string;
  createTab: () => void;
  closeTab: (id: string) => void;
  closeAllTabs: () => void;
  restoreTabs: (tabs: readonly RestorableTab[]) => Promise<void>;
  reorderTab: (id: string, targetIndex: number) => void;
  switchTab: (id: string) => void;
  updateTabTitle: (id: string, title: string) => void;
}

/**
 * The tab bar over a `DocumentIndex` (by default the sandbox's shared
 * `global-tabs` list). The index holds the list; this hook adds what is
 * per-window: the active tab (persisted locally), the title debounce, the
 * tab cap, confirmations and the Undo pill. `createIndex` must be stable.
 */
export function useSyncedTabs(
  createIndex: () => DocumentIndex = createGlobalTabsIndex,
): UseSyncedTabsReturn {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState("");
  const [ready, setReady] = useState(false);
  const activeTabIdRef = useRef("");
  const indexRef = useRef<DocumentIndex | null>(null);
  const titleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const index = createIndex();
    indexRef.current = index;

    // Runs synchronously inside Yjs transactions, so plain setState is used:
    // local mutations (e.g. dnd-kit onDragEnd) are already batched by React,
    // and flushSync here re-renders mid-transaction.
    const onIndex: DocumentIndexListener = (type, snapshot) => {
      const currentTabs = [...snapshot.items];
      setTabs(currentTabs);

      if (type === "load") {
        // Every (re)load re-reads this browser's stored choice.
        const validActive = resolveActiveTabId(
          currentTabs,
          loadActiveTabIdFromStorage(),
        );
        setActiveTabId(validActive);
        activeTabIdRef.current = validActive;
        persistActiveTabId(validActive);
        setReady(true);
        return;
      }

      const currentActive = activeTabIdRef.current;
      if (!currentActive) return;
      const validActive = resolveActiveTabId(currentTabs, currentActive);
      if (validActive === currentActive) return;
      activeTabIdRef.current = validActive;
      setActiveTabId(validActive);
      persistActiveTabId(validActive);
    };

    const unsubscribe = index.subscribe(onIndex);
    // An index that was ready before we subscribed (a reused session).
    const initial = index.snapshot();
    if (initial.ready) onIndex("load", initial);

    return () => {
      if (titleDebounceRef.current) {
        clearTimeout(titleDebounceRef.current);
        titleDebounceRef.current = null;
      }
      indexRef.current = null;
      unsubscribe();
      index.destroy();
      setReady(false);
    };
  }, [createIndex]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  const createTabLimitMessage = `Maximum tabs reached (${MAX_TABS_PER_CLIENT})`;

  const createTab = useCallback(() => {
    const index = indexRef.current;
    if (!index) return;
    const count = index.snapshot().items.length;
    if (count >= MAX_TABS_PER_CLIENT) return;
    const tab = index.create();
    if (!tab) return;
    trackEvent("tab_create", { tab_count: count + 1 });
    setActiveTabId(tab.id);
    persistActiveTabId(tab.id);
  }, []);

  // Stable for the hook's life: the lazy restore code reads the live index.
  const [tabList] = useState<TabList>(() => ({
    index: () => indexRef.current,
    activate: (id) => {
      activeTabIdRef.current = id;
      setActiveTabId(id);
      persistActiveTabId(id);
    },
  }));

  const restoreTabs = useCallback(
    async (entries: readonly RestorableTab[]) =>
      (await loadTabRestore()).restoreTabs(tabList, entries),
    [tabList],
  );

  const offerUndo = useCallback(
    async (closed: readonly RestorableTab[]) =>
      (await loadTabRestore()).offerUndo(tabList, closed),
    [tabList],
  );

  const closeTab = useCallback(
    async (id: string) => {
      if (closingRef.current) return;
      const index = indexRef.current;
      if (!index || id === PLAYGROUND_ID) return;
      const current = index.snapshot().items;
      if (current.length <= 1) return;
      const idx = current.findIndex((t) => t.id === id);
      if (idx < 0) return;

      closingRef.current = true;
      const { trashed } = await index.trash([id]).finally(() => {
        closingRef.current = false;
      });
      if (trashed.length === 0) {
        alert("Could not close tab");
        return;
      }

      const newActive =
        activeTabIdRef.current === id
          ? (current[idx === current.length - 1 ? idx - 1 : idx + 1]?.id ??
            current[0]?.id ??
            PLAYGROUND_ID)
          : activeTabIdRef.current;
      tabList.activate(newActive);
      await offerUndo(trashed);
    },
    [tabList, offerUndo],
  );

  const closeAllTabs = useCallback(async () => {
    if (closingRef.current) return;
    const index = indexRef.current;
    if (!index) return;
    const current = index.snapshot().items;
    const userTabs = current.filter((t) => t.id !== PLAYGROUND_ID);
    if (userTabs.length === 0) return;

    const confirmed = window.confirm(
      `Close all ${userTabs.length} tab${userTabs.length === 1 ? "" : "s"}?`,
    );
    if (!confirmed) return;

    closingRef.current = true;
    const { trashed, failed } = await index
      .trash(userTabs.map((t) => t.id))
      .finally(() => {
        closingRef.current = false;
      });

    if (failed.length > 0) {
      const titles = current
        .filter((t) => failed.includes(t.id))
        .map((t) => t.title || "Untitled")
        .join(", ");
      alert(`Could not close: ${titles}`);
    }
    if (trashed.length > 0) {
      trackEvent("tab_close_all", { closed_count: trashed.length });
    }

    const next = index.snapshot().items[0] ?? index.create();
    tabList.activate(next?.id ?? PLAYGROUND_ID);
    await offerUndo(trashed);
  }, [tabList, offerUndo]);

  const reorderTab = useCallback((id: string, targetIndex: number) => {
    indexRef.current?.move(id, targetIndex);
  }, []);

  const switchTab = useCallback((id: string) => {
    setActiveTabId(id);
    persistActiveTabId(id);
  }, []);

  const updateTabTitle = useCallback((id: string, title: string) => {
    if (!indexRef.current) return;
    if (titleDebounceRef.current) {
      clearTimeout(titleDebounceRef.current);
    }
    titleDebounceRef.current = setTimeout(() => {
      titleDebounceRef.current = null;
      indexRef.current?.rename(id, title);
    }, 300);
  }, []);

  return {
    ready,
    tabs,
    activeTabId,
    canCreateTab: tabs.length < MAX_TABS_PER_CLIENT,
    createTabLimitMessage,
    createTab,
    closeTab,
    closeAllTabs,
    restoreTabs,
    reorderTab,
    switchTab,
    updateTabTitle,
  };
}
